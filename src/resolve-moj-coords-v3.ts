import axios from "axios"
import { getDb } from "./db.js"

// Use Nominatim (OpenStreetMap) to geocode Jordanian village/city names
async function geocode(placeName: string, governorate: string | null): Promise<{ lat: number; lng: number } | null> {
  const query = `${placeName}${governorate ? ', ' + governorate : ''}, Jordan`
  try {
    const r = await axios.get("https://nominatim.openstreetmap.org/search", {
      params: { q: query, format: "json", limit: 1, countrycodes: "jo" },
      headers: { "User-Agent": "JordanPropertyIntel/1.0 (research)" },
      timeout: 10000,
    })
    if (r.data?.[0]) {
      return { lat: parseFloat(r.data[0].lat), lng: parseFloat(r.data[0].lon) }
    }
  } catch { /* skip */ }
  return null
}

async function main() {
  const db = getDb()
  console.log("=== RESOLVING MOJ COORDS VIA GEOCODING ===\n")

  const auctions = db.prepare(`
    SELECT o.id as obs_id, o.village, o.governorate, sr.source_property_id
    FROM observations o
    JOIN source_records sr ON sr.id = o.source_record_id
    WHERE sr.institution_id = 'moj_auctions' AND sr.currently_active = 1
      AND o.latitude IS NULL AND o.village IS NOT NULL AND o.village != ''
      AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
  `).all() as any[]

  console.log(`Auctions to geocode: ${auctions.length}`)

  // Cache geocode results to avoid repeating same village
  const cache = new Map<string, { lat: number; lng: number } | null>()
  const update = db.prepare("UPDATE observations SET latitude = ?, longitude = ? WHERE id = ?")
  let resolved = 0, cached = 0, failed = 0

  for (let i = 0; i < auctions.length; i++) {
    const a = auctions[i]
    const key = `${a.village}|${a.governorate || ""}`

    let coords: { lat: number; lng: number } | null
    if (cache.has(key)) {
      coords = cache.get(key)!
      if (coords) cached++
    } else {
      coords = await geocode(a.village, a.governorate)
      cache.set(key, coords)
      // Nominatim rate limit: 1 request/second
      await new Promise(r => setTimeout(r, 1100))
    }

    if (coords) {
      // Add slight jitter so markers don't all stack
      const jitter = () => (Math.random() - 0.5) * 0.003
      update.run(coords.lat + jitter(), coords.lng + jitter(), a.obs_id)
      resolved++
    } else {
      failed++
    }

    if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${auctions.length} — ${resolved} resolved, ${failed} failed, ${cache.size} unique villages`)
  }

  console.log(`\n=== RESULTS ===`)
  console.log(`Resolved: ${resolved}/${auctions.length} (${Math.round(resolved / auctions.length * 100)}%)`)
  console.log(`From cache: ${cached}`)
  console.log(`Failed: ${failed}`)
  console.log(`Unique villages geocoded: ${cache.size}`)
  console.log(`Geocode success rate: ${[...cache.values()].filter(Boolean).length}/${cache.size}`)
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1) })
