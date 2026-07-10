import axios from "axios"
import * as cheerio from "cheerio"
import { getDb, contentHash } from "./db.js"

const INSTITUTION_ID = "bank_al_etihad"

// Wayback Machine snapshots for Bank al Etihad Arabic real estate page
const SNAPSHOTS = [
  { timestamp: "20250321013237", date: "2025-03-21" },
  { timestamp: "20250620231038", date: "2025-06-20" },
  { timestamp: "20250803172533", date: "2025-08-03" },
  { timestamp: "20251110081647", date: "2025-11-10" },
  { timestamp: "20260208234333", date: "2026-02-08" },
]

interface EtihadProperty {
  id: number
  slug: string
  title: string
  description: string
  price: string
  city: string
  realEstateType: string
  locationName: string
  locationLink: string
  params: Array<{ icon: string; value: string }>
  propertyDetails: Array<{ name: string; value: string }>
}

function parseDetail(details: Array<{ name: string; value: string }>, name: string): string | null {
  const d = details?.find(d => d.name?.toLowerCase().includes(name.toLowerCase()))
  return d?.value?.trim() || null
}

async function main() {
  const db = getDb()
  console.log("=== BACKFILLING HISTORICAL DATA FROM WAYBACK MACHINE ===\n")

  for (const snap of SNAPSHOTS) {
    const url = `https://web.archive.org/web/${snap.timestamp}/https://www.bankaletihad.com/ar/real-estate/`
    console.log(`\n--- Snapshot: ${snap.date} ---`)
    console.log(`URL: ${url}`)

    try {
      const resp = await axios.get(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        timeout: 30000,
      })
      const $ = cheerio.load(resp.data)

      // Find __NEXT_DATA__
      const nextDataScript = $("#__NEXT_DATA__").html()
      if (!nextDataScript) {
        console.log("  No __NEXT_DATA__ found")
        continue
      }

      const nextData = JSON.parse(nextDataScript)
      const realEstate = nextData?.props?.pageProps?.initialState?.pages?.realEstate
      if (!realEstate) {
        console.log("  No realEstate data")
        continue
      }

      const cards: EtihadProperty[] = realEstate.recordsCards || []
      const hasMore = realEstate.hasMore ?? false
      console.log(`  Found ${cards.length} properties (hasMore: ${hasMore})`)

      // Try to get more via paginated snapshots
      let allCards = [...cards]
      if (hasMore) {
        const buildId = nextData.buildId
        if (buildId) {
          for (let page = 2; page <= 10; page++) {
            try {
              const pageUrl = `https://web.archive.org/web/${snap.timestamp}/https://www.bankaletihad.com/_next/data/${buildId}/ar/real-estate.json?page=${page}`
              const pageResp = await axios.get(pageUrl, { timeout: 15000 })
              const pageData = pageResp.data?.pageProps?.initialState?.pages?.realEstate
              const pageCards = pageData?.recordsCards || []
              if (pageCards.length > allCards.length) {
                allCards = pageCards // Cumulative
                console.log(`  Page ${page}: ${pageCards.length} total`)
              }
              if (!pageData?.hasMore) break
              await new Promise(r => setTimeout(r, 1000))
            } catch {
              break
            }
          }
        }
      }

      console.log(`  Total properties in snapshot: ${allCards.length}`)

      // For each property, create a historical observation
      let created = 0, existing = 0

      for (const raw of allCards) {
        const sourceId = raw.slug || String(raw.id)
        const areaSqm = raw.params?.[0]?.value ? parseFloat(raw.params[0].value) : null
        const basin = parseDetail(raw.propertyDetails || [], "basin")
        const department = parseDetail(raw.propertyDetails || [], "department")
        const landNo = parseDetail(raw.propertyDetails || [], "land no")
        const price = raw.price ? parseFloat(raw.price.replace(/[^0-9.]/g, "")) : null

        const normalized = {
          price, area_sqm: areaSqm, land_area_sqm: null as number | null,
          property_type: raw.realEstateType || null, title: raw.title || null,
          description: raw.description || null, governorate: null as string | null,
          city: raw.city || null, neighborhood: department,
          village: null as string | null, basin, parcel_number: landNo,
          zoning: null as string | null, latitude: null as number | null,
          longitude: null as number | null, image_urls: null as string | null,
        }
        const hash = contentHash(normalized)

        // Ensure source record exists
        db.prepare(`
          INSERT INTO source_records (institution_id, source_property_id, source_url, raw_data, first_seen_at, last_seen_at, currently_active)
          VALUES (?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(institution_id, source_property_id) DO UPDATE SET
            first_seen_at = MIN(source_records.first_seen_at, excluded.first_seen_at)
        `).run(INSTITUTION_ID, sourceId, `https://www.bankaletihad.com/en/real-estate/form/?id=${raw.id}`,
          JSON.stringify(raw), snap.date + "T00:00:00Z", snap.date + "T00:00:00Z")

        const sourceRow = db.prepare("SELECT id FROM source_records WHERE institution_id = ? AND source_property_id = ?")
          .get(INSTITUTION_ID, sourceId) as { id: number } | undefined
        if (!sourceRow) continue

        // Check if we already have an observation for this exact date
        const existingObs = db.prepare(
          "SELECT id FROM observations WHERE source_record_id = ? AND observed_at LIKE ?"
        ).get(sourceRow.id, snap.date + "%") as any

        if (existingObs) {
          existing++
          continue
        }

        // Insert historical observation
        db.prepare(`
          INSERT INTO observations (source_record_id, observed_at, price, area_sqm, land_area_sqm,
            property_type, title, description, governorate, city, neighborhood, village, basin, parcel_number,
            zoning, latitude, longitude, image_urls, content_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          sourceRow.id, snap.date + "T00:00:00Z",
          normalized.price, normalized.area_sqm, normalized.land_area_sqm,
          normalized.property_type, normalized.title, normalized.description,
          normalized.governorate, normalized.city, normalized.neighborhood,
          normalized.village, normalized.basin, normalized.parcel_number,
          normalized.zoning, normalized.latitude, normalized.longitude,
          normalized.image_urls, hash
        )
        created++
      }

      console.log(`  Created: ${created} observations, Skipped: ${existing} existing`)

      // Also update first_seen_at for matching source records
      const updated = db.prepare(`
        UPDATE source_records SET first_seen_at = ?
        WHERE institution_id = ? AND first_seen_at > ? AND source_property_id IN (${allCards.map(() => "?").join(",")})
      `).run(snap.date + "T00:00:00Z", INSTITUTION_ID, snap.date + "T00:00:00Z",
        ...allCards.map(c => c.slug || String(c.id)))
      console.log(`  Updated first_seen_at for ${updated.changes} records`)

      await new Promise(r => setTimeout(r, 2000)) // Be polite to Wayback Machine

    } catch (err: any) {
      console.log(`  Failed: ${err.message}`)
    }
  }

  // Summary: how many properties now have multiple observations?
  const multiObs = db.prepare(`
    SELECT sr.source_property_id, COUNT(o.id) as obs_count, MIN(o.observed_at) as earliest, MAX(o.observed_at) as latest
    FROM source_records sr
    JOIN observations o ON o.source_record_id = sr.id
    WHERE sr.institution_id = 'bank_al_etihad'
    GROUP BY sr.id
    HAVING COUNT(o.id) > 1
    ORDER BY obs_count DESC
  `).all() as any[]

  console.log(`\n\n=== HISTORY SUMMARY ===`)
  console.log(`Properties with multiple observations: ${multiObs.length}`)
  for (const m of multiObs.slice(0, 10)) {
    console.log(`  ${m.source_property_id}: ${m.obs_count} observations (${m.earliest.slice(0, 10)} → ${m.latest.slice(0, 10)})`)
  }

  // Check for price changes
  const priceChanges = db.prepare(`
    SELECT sr.source_property_id, o1.price as old_price, o1.observed_at as old_date,
      o2.price as new_price, o2.observed_at as new_date
    FROM source_records sr
    JOIN observations o1 ON o1.source_record_id = sr.id
    JOIN observations o2 ON o2.source_record_id = sr.id
    WHERE sr.institution_id = 'bank_al_etihad'
    AND o1.id < o2.id AND o1.price != o2.price AND o1.price > 0 AND o2.price > 0
    ORDER BY sr.source_property_id
  `).all() as any[]

  console.log(`\nPrice changes detected: ${priceChanges.length}`)
  for (const pc of priceChanges.slice(0, 15)) {
    const pct = Math.round((pc.new_price - pc.old_price) / pc.old_price * 100)
    console.log(`  ${pc.source_property_id}: ${pc.old_price} → ${pc.new_price} (${pct > 0 ? "+" : ""}${pct}%) [${pc.old_date.slice(0, 10)} → ${pc.new_date.slice(0, 10)}]`)
  }
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1) })
