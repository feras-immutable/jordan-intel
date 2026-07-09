import axios from "axios"
import Database from "better-sqlite3"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const db = new Database(join(__dirname, "..", "jordan-intel.db"))

const APP_ID = "LL8IZ711CS"
const API_KEY = "eba05366688fef592618f7defd9f3e7e"
const INDEX = "bayut-jo-production-ads-city-level-score-en"

async function searchAlgolia(query: string, page: number, hitsPerPage: number) {
  const resp = await axios.post(
    `https://${APP_ID}-dsn.algolia.net/1/indexes/${INDEX}/query`,
    { query, page, hitsPerPage, filters: "purpose:for-sale" },
    {
      headers: {
        "X-Algolia-Application-Id": APP_ID,
        "X-Algolia-API-Key": API_KEY,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    }
  )
  return resp.data
}

// Extract basin and parcel from Arabic text
function extractParcelFromArabic(text: string): { basin: string | null; basinNum: number | null; parcel: number | null } {
  // حوض المدورة (9) = Basin Al-Madoura (9)
  // حوض 9 = Basin 9
  // حوض المطار رقم 6 = Basin Airport number 6
  const basinMatch = text.match(/حوض\s+([^\d,،\n]+?)(?:\s*(?:رقم|#)?\s*\(?\s*(\d+)\s*\)?)?(?:[,،\s]|$)/i)
    || text.match(/حوض\s*(?:رقم|#)?\s*\(?\s*(\d+)\s*\)?/i)

  let basin: string | null = null
  let basinNum: number | null = null
  if (basinMatch) {
    if (basinMatch[2]) {
      basin = basinMatch[1]?.trim() || null
      basinNum = parseInt(basinMatch[2])
    } else if (basinMatch[1] && /^\d+$/.test(basinMatch[1].trim())) {
      basinNum = parseInt(basinMatch[1].trim())
    } else {
      basin = basinMatch[1]?.trim() || null
    }
  }

  // قطعة رقم 234 = Plot number 234
  // قطعة (234) = Plot (234)
  // قطعة 234 = Plot 234
  const parcelMatch = text.match(/قطعة\s*(?:رقم\s*)?(?:\(\s*)?(\d+)(?:\s*\))?/i)
    || text.match(/رقم القطعة\s*:?\s*(\d+)/i)
  const parcel = parcelMatch ? parseInt(parcelMatch[1]) : null

  return { basin, basinNum, parcel }
}

async function main() {
  console.log("=== BAYUT RETAIL EXPERIMENT: 50 AMMAN LAND LISTINGS ===\n")

  // Fetch 50 land listings from Amman
  const results = await searchAlgolia("أرض للبيع عمان", 0, 50)
  console.log(`Total available: ${results.nbHits}`)
  console.log(`Fetched: ${results.hits.length}\n`)

  // Also fetch the detail descriptions for parcel info
  // The Algolia results have titles but descriptions are on the detail pages
  // For now, use the JSON-LD descriptions from detail pages for a subset

  let resolved = 0
  let partialResolved = 0
  let unresolved = 0
  let hasCoords = 0
  const parcelKeys: string[] = []
  const listings: Array<{
    id: string; title: string; price: number; area: number;
    lat: number; lng: number; location: string;
    basin: string | null; basinNum: number | null; parcel: number | null;
    parcelKey: string | null;
  }> = []

  for (const hit of results.hits) {
    const loc = hit.location?.map((l: any) => l.name).join(" > ") || ""
    const neighborhood = hit.location?.[2]?.name || hit.location?.[1]?.name || ""
    const title = hit.title_l1 || hit.title || ""
    const lat = hit._geoloc?.lat || 0
    const lng = hit._geoloc?.lng || 0

    if (lat && lng) hasCoords++

    // Try to extract parcel info from Arabic title
    const { basin, basinNum, parcel } = extractParcelFromArabic(title)

    let parcelKey: string | null = null
    if (basinNum && parcel) {
      // We have basin number + parcel — but no village ID from the title
      // We might be able to infer village from the neighborhood name
      parcelKey = `?:${basinNum}:${parcel}`
      resolved++
    } else if (parcel || basinNum) {
      partialResolved++
    } else {
      unresolved++
    }

    listings.push({
      id: hit.externalID, title, price: hit.price, area: hit.area,
      lat, lng, location: neighborhood,
      basin, basinNum, parcel, parcelKey,
    })
  }

  console.log("PARCEL RESOLUTION")
  console.log("─".repeat(50))
  console.log(`  Basin + Parcel extracted: ${resolved} (${Math.round(resolved / 50 * 100)}%)`)
  console.log(`  Partial (basin or parcel only): ${partialResolved}`)
  console.log(`  Unresolved: ${unresolved}`)
  console.log(`  Has coordinates: ${hasCoords}`)

  // Now check for overlaps with bank inventory
  console.log("\n\nCROSS-SOURCE COLLISION CHECK")
  console.log("─".repeat(50))

  // Get all bank parcel keys
  const bankParcels = db.prepare(`
    SELECT p.canonical_key, p.basin_id, p.parcel_number, p.village_id,
      sr.source_property_id, o.price, i.name_en as bank_name
    FROM parcels p
    JOIN source_record_parcels srp ON srp.parcel_id = p.id
    JOIN source_records sr ON sr.id = srp.source_record_id
    JOIN observations o ON o.source_record_id = sr.id
      AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
    JOIN institutions i ON i.id = sr.institution_id
    WHERE sr.currently_active = 1
  `).all() as any[]

  console.log(`Bank parcels to compare: ${bankParcels.length}`)

  // Try to match by basin_id + parcel_number (ignoring village since retail doesn't have it)
  let collisions = 0
  const collisionDetails: any[] = []

  for (const listing of listings) {
    if (!listing.basinNum || !listing.parcel) continue

    const matches = bankParcels.filter(bp =>
      bp.basin_id === listing.basinNum && bp.parcel_number === listing.parcel
    )

    if (matches.length > 0) {
      collisions++
      for (const m of matches) {
        collisionDetails.push({
          retailId: listing.id,
          retailTitle: listing.title.slice(0, 60),
          retailPrice: listing.price,
          bankRef: m.source_property_id,
          bankName: m.bank_name,
          bankPrice: m.price,
          bankKey: m.canonical_key,
          basinId: listing.basinNum,
          parcelNum: listing.parcel,
        })
      }
    }
  }

  console.log(`\nCollisions found: ${collisions}`)
  if (collisionDetails.length > 0) {
    console.log("\n🔥 CROSS-SOURCE MATCHES:")
    for (const c of collisionDetails) {
      console.log(`\n  SAME PARCEL — Basin ${c.basinId}, Parcel ${c.parcelNum}`)
      console.log(`  Retail: ${c.retailTitle}`)
      console.log(`    Price: ${c.retailPrice} JOD`)
      console.log(`  Bank: ${c.bankName} — ${c.bankRef}`)
      console.log(`    Price: ${c.bankPrice} JOD`)
      const diff = c.retailPrice && c.bankPrice ? Math.round(Math.abs(c.retailPrice - c.bankPrice) / Math.max(c.retailPrice, c.bankPrice) * 100) : null
      if (diff) console.log(`    Price difference: ${diff}%`)
    }
  }

  // Also check by coordinate proximity (within ~100m)
  console.log("\n\nPROXIMITY CHECK (within 200m)")
  console.log("─".repeat(50))

  const bankCoords = db.prepare(`
    SELECT p.canonical_key, o.latitude, o.longitude, o.price, sr.source_property_id, i.name_en as bank_name
    FROM parcels p
    JOIN source_record_parcels srp ON srp.parcel_id = p.id
    JOIN source_records sr ON sr.id = srp.source_record_id
    JOIN observations o ON o.source_record_id = sr.id
      AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
    JOIN institutions i ON i.id = sr.institution_id
    WHERE sr.currently_active = 1 AND o.latitude IS NOT NULL
  `).all() as any[]

  let proximityMatches = 0
  for (const listing of listings) {
    if (!listing.lat || !listing.lng) continue
    for (const bp of bankCoords) {
      if (!bp.latitude || !bp.longitude) continue
      // Rough distance in meters (at Jordan's latitude)
      const dlat = (listing.lat - bp.latitude) * 111000
      const dlng = (listing.lng - bp.longitude) * 111000 * Math.cos(listing.lat * Math.PI / 180)
      const dist = Math.sqrt(dlat * dlat + dlng * dlng)
      if (dist < 200) {
        proximityMatches++
        console.log(`  Within ${Math.round(dist)}m:`)
        console.log(`    Retail: ${listing.title.slice(0, 50)} — ${listing.price} JOD`)
        console.log(`    Bank: ${bp.bank_name} ${bp.source_property_id} — ${bp.price} JOD`)
      }
    }
  }
  console.log(`\nProximity matches: ${proximityMatches}`)

  // Show sample listings with their parcel extraction
  console.log("\n\n=== SAMPLE LISTINGS (first 10) ===")
  for (const l of listings.slice(0, 10)) {
    console.log(`\n${l.id}: ${l.title.slice(0, 70)}`)
    console.log(`  Price: ${l.price} JOD | Area: ${l.area} | Location: ${l.location}`)
    console.log(`  Coords: ${l.lat}, ${l.lng}`)
    console.log(`  Basin: ${l.basin || "—"} (#${l.basinNum || "—"}) | Parcel: ${l.parcel || "—"}`)
    console.log(`  Parcel key: ${l.parcelKey || "UNRESOLVED"}`)
  }

  // Summary
  console.log("\n\n=== EXPERIMENT SUMMARY ===")
  console.log("─".repeat(50))
  console.log(`Listings analyzed: 50`)
  console.log(`Parcel resolution: ${resolved}/50 (${Math.round(resolved / 50 * 100)}%)`)
  console.log(`Coordinates: ${hasCoords}/50 (${Math.round(hasCoords / 50 * 100)}%)`)
  console.log(`Cross-source collisions (exact): ${collisions}`)
  console.log(`Proximity matches (<200m): ${proximityMatches}`)
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1) })
