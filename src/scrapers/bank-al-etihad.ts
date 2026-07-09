import axios from "axios"
import * as cheerio from "cheerio"
import { getDb, contentHash } from "../db.js"

const INSTITUTION_ID = "bank_al_etihad"
const BASE_URL = "https://www.bankaletihad.com"
const LISTING_URL = `${BASE_URL}/en/real-estate/`

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
  icon?: string
  image?: string
  images?: string[]
}

function parseDetail(details: Array<{ name: string; value: string }>, name: string): string | null {
  const d = details?.find(d => d.name?.toLowerCase().includes(name.toLowerCase()))
  return d?.value?.trim() || null
}

function parseCoords(locationLink: string): { lat: number; lng: number } | null {
  if (!locationLink) return null
  // Try Google Maps short link patterns
  const match = locationLink.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
  if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) }
  return null
}

function normalizeProperty(raw: EtihadProperty) {
  const areaSqm = raw.params?.[0]?.value ? parseFloat(raw.params[0].value) : null
  const coords = parseCoords(raw.locationLink)

  // Parse propertyDetails for parcel identity
  const basin = parseDetail(raw.propertyDetails || [], "basin")
  const department = parseDetail(raw.propertyDetails || [], "department")
  const landNo = parseDetail(raw.propertyDetails || [], "land no")

  const price = raw.price ? parseFloat(raw.price.replace(/[^0-9.]/g, "")) : null

  return {
    price,
    area_sqm: areaSqm,
    land_area_sqm: null as number | null,
    property_type: raw.realEstateType || null,
    title: raw.title || null,
    description: raw.description || null,
    governorate: null as string | null,
    city: raw.city || null,
    neighborhood: department,
    village: null as string | null,
    basin,
    parcel_number: landNo,
    zoning: null as string | null,
    latitude: coords?.lat ?? null,
    longitude: coords?.lng ?? null,
    image_urls: raw.images?.length ? JSON.stringify(raw.images) : (raw.image ? JSON.stringify([raw.image]) : null),
  }
}

export async function scrapeEtihad(): Promise<number> {
  const db = getDb()
  const now = new Date().toISOString()

  // Create ingestion run
  const run = db.prepare(`
    INSERT INTO ingestion_runs (institution_id, started_at, status, parser_version)
    VALUES (?, ?, 'running', 'etihad-v2-nextdata')
  `).run(INSTITUTION_ID, now)
  const runId = run.lastInsertRowid as number

  try {
    console.log(`[etihad] Fetching ${LISTING_URL}`)
    const resp = await axios.get(LISTING_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      timeout: 30000,
    })

    const $ = cheerio.load(resp.data)
    const nextDataScript = $("#__NEXT_DATA__").html()
    if (!nextDataScript) throw new Error("No __NEXT_DATA__ found")

    const nextData = JSON.parse(nextDataScript)
    const realEstate = nextData?.props?.pageProps?.initialState?.pages?.realEstate
    if (!realEstate) throw new Error("No realEstate data in __NEXT_DATA__")

    const buildId = nextData.buildId
    if (!buildId) throw new Error("No buildId in __NEXT_DATA__")

    // Data lives in recordsCards (array), cumulative via _next/data/?page=N
    const initialCards: EtihadProperty[] = realEstate.recordsCards || []
    const hasMore = realEstate.hasMore ?? false
    console.log(`[etihad] Found ${initialCards.length} in initial load, hasMore: ${hasMore}, buildId: ${buildId}`)

    let allListings = [...initialCards]

    // Paginate using the _next/data JSON endpoint — returns cumulative results
    if (hasMore) {
      const dataUrl = `${BASE_URL}/_next/data/${buildId}/en/real-estate.json`
      for (let page = 2; page <= 20; page++) {
        try {
          const pageResp = await axios.get(`${dataUrl}?page=${page}`, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "application/json" },
            timeout: 15000,
          })
          const pageData = pageResp.data?.pageProps?.initialState?.pages?.realEstate
          const cards = pageData?.recordsCards || []
          const pageHasMore = pageData?.hasMore ?? false
          allListings = cards // Cumulative — replace, not append
          console.log(`[etihad] Page ${page}: ${cards.length} total cards, hasMore: ${pageHasMore}`)
          if (!pageHasMore) break
          await new Promise(r => setTimeout(r, 300))
        } catch (err: any) {
          console.warn(`[etihad] Failed page ${page}: ${err.message}`)
          break
        }
      }
    }

    console.log(`[etihad] Total: ${allListings.length} properties`)

    console.log(`[etihad] Processing ${allListings.length} properties`)

    let newCount = 0
    let changedCount = 0

    const upsertSource = db.prepare(`
      INSERT INTO source_records (institution_id, source_property_id, source_url, raw_data, first_seen_at, last_seen_at, currently_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(institution_id, source_property_id) DO UPDATE SET
        raw_data = excluded.raw_data,
        last_seen_at = excluded.last_seen_at,
        currently_active = 1
    `)

    const insertObs = db.prepare(`
      INSERT INTO observations (source_record_id, ingestion_run_id, observed_at, price, area_sqm, land_area_sqm,
        property_type, title, description, governorate, city, neighborhood, village, basin, parcel_number,
        zoning, latitude, longitude, image_urls, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const getSource = db.prepare(`
      SELECT id FROM source_records WHERE institution_id = ? AND source_property_id = ?
    `)

    const getLastObs = db.prepare(`
      SELECT content_hash FROM observations WHERE source_record_id = ? ORDER BY observed_at DESC LIMIT 1
    `)

    const insertEvent = db.prepare(`
      INSERT INTO change_events (source_record_id, event_type, detected_at, old_value, new_value, detail)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    for (const raw of allListings) {
      const sourceId = raw.slug || String(raw.id)
      const sourceUrl = raw.id ? `${BASE_URL}/en/real-estate/form/?id=${raw.id}` : `${BASE_URL}/en/real-estate/`
      const normalized = normalizeProperty(raw)
      const hash = contentHash(normalized)

      // Upsert source record
      upsertSource.run(
        INSTITUTION_ID, sourceId, sourceUrl,
        JSON.stringify(raw), now, now
      )

      // Get source record id
      const sourceRow = getSource.get(INSTITUTION_ID, sourceId) as { id: number } | undefined
      if (!sourceRow) continue
      const srcId = sourceRow.id

      // Check if this is new or changed
      const lastObs = getLastObs.get(srcId) as { content_hash: string } | undefined

      if (!lastObs) {
        // Brand new property
        newCount++
        insertEvent.run(srcId, "NEW", now, null, null,
          `${normalized.property_type || "property"}: ${normalized.title} — ${normalized.price ? normalized.price + " JOD" : "no price"}`)
      } else if (lastObs.content_hash !== hash) {
        changedCount++
        // Detect specific changes
        const prevObs = db.prepare(`
          SELECT price, title, description FROM observations
          WHERE source_record_id = ? ORDER BY observed_at DESC LIMIT 1
        `).get(srcId) as any

        if (prevObs && normalized.price && prevObs.price && normalized.price !== prevObs.price) {
          const pctChange = ((normalized.price - prevObs.price) / prevObs.price * 100).toFixed(1)
          const eventType = normalized.price < prevObs.price ? "PRICE_REDUCED" : "PRICE_INCREASED"
          insertEvent.run(srcId, eventType, now,
            String(prevObs.price), String(normalized.price),
            `${prevObs.price} → ${normalized.price} JOD (${pctChange}%)`)
        }
      } else {
        // No change — skip creating duplicate observation
        continue
      }

      // Insert observation
      insertObs.run(
        srcId, runId, now,
        normalized.price, normalized.area_sqm, normalized.land_area_sqm,
        normalized.property_type, normalized.title, normalized.description,
        normalized.governorate, normalized.city, normalized.neighborhood,
        normalized.village, normalized.basin, normalized.parcel_number,
        normalized.zoning, normalized.latitude, normalized.longitude,
        normalized.image_urls, hash
      )
    }

    // Same consecutive_misses logic as Housing Bank
    const MISS_THRESHOLD = 3
    db.prepare(`
      UPDATE source_records SET consecutive_misses = consecutive_misses + 1
      WHERE institution_id = ? AND last_seen_at < ? AND currently_active = 1
    `).run(INSTITUTION_ID, now)
    db.prepare(`
      UPDATE source_records SET consecutive_misses = 0
      WHERE institution_id = ? AND last_seen_at >= ?
    `).run(INSTITUTION_ID, now)

    const markInactive = db.prepare(`
      UPDATE source_records SET currently_active = 0
      WHERE institution_id = ? AND consecutive_misses >= ? AND currently_active = 1
    `)
    const removed = markInactive.run(INSTITUTION_ID, MISS_THRESHOLD)
    const removedCount = removed.changes

    if (removedCount > 0) {
      const justRemoved = db.prepare(`
        SELECT id, source_property_id FROM source_records
        WHERE institution_id = ? AND currently_active = 0 AND consecutive_misses >= ?
      `).all(INSTITUTION_ID, MISS_THRESHOLD) as Array<{ id: number; source_property_id: string }>
      for (const r of justRemoved) {
        const existingEvent = db.prepare(`
          SELECT 1 FROM change_events WHERE source_record_id = ? AND event_type = 'REMOVED' AND detected_at >= date(?)
        `).get(r.id, now)
        if (!existingEvent) {
          insertEvent.run(r.id, "REMOVED", now, null, null, `Property ${r.source_property_id} no longer listed (missed ${MISS_THRESHOLD}+ runs)`)
        }
      }
    }

    // Update run
    db.prepare(`
      UPDATE ingestion_runs SET completed_at = ?, records_found = ?, records_new = ?,
        records_changed = ?, records_removed = ?, status = 'completed'
      WHERE id = ?
    `).run(new Date().toISOString(), allListings.length, newCount, changedCount, removedCount, runId)

    console.log(`[etihad] Done: ${allListings.length} found, ${newCount} new, ${changedCount} changed, ${removedCount} removed`)
    return allListings.length

  } catch (err: any) {
    db.prepare(`UPDATE ingestion_runs SET completed_at = ?, status = 'failed', error = ? WHERE id = ?`)
      .run(new Date().toISOString(), err.message, runId)
    console.error(`[etihad] Failed:`, err.message)
    throw err
  }
}
