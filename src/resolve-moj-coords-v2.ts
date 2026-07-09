import { getDb } from "./db.js"

async function main() {
  const db = getDb()
  console.log("=== RESOLVING MOJ COORDS FROM BANK DATA ===\n")

  // Build village name → average coordinate from bank properties
  const bankCoords = db.prepare(`
    SELECT o.village, AVG(o.latitude) as lat, AVG(o.longitude) as lng, COUNT(*) as cnt
    FROM observations o
    JOIN source_records sr ON sr.id = o.source_record_id
    WHERE sr.institution_id IN ('housing_bank', 'bank_al_etihad')
      AND sr.currently_active = 1
      AND o.latitude IS NOT NULL AND o.village IS NOT NULL AND o.village != ''
      AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
    GROUP BY o.village
  `).all() as any[]

  // Build lookup — extract the clean village name (strip the "(130)" part)
  const villageLookup = new Map<string, { lat: number; lng: number }>()
  for (const b of bankCoords) {
    const cleanName = b.village.replace(/\s*\(\d+\)\s*$/, "").trim()
    villageLookup.set(cleanName, { lat: b.lat, lng: b.lng })
    // Also store original
    villageLookup.set(b.village, { lat: b.lat, lng: b.lng })
  }
  console.log(`Village lookup built: ${villageLookup.size} entries`)

  // Get MOJ auctions without coordinates
  const auctions = db.prepare(`
    SELECT o.id as obs_id, o.village, o.basin, o.governorate
    FROM observations o
    JOIN source_records sr ON sr.id = o.source_record_id
    WHERE sr.institution_id = 'moj_auctions' AND sr.currently_active = 1
      AND o.latitude IS NULL AND o.village IS NOT NULL AND o.village != ''
      AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
  `).all() as any[]

  console.log(`MOJ auctions without coords: ${auctions.length}\n`)

  const update = db.prepare("UPDATE observations SET latitude = ?, longitude = ? WHERE id = ?")
  let matched = 0, unmatched = 0
  const unmatchedVillages = new Set<string>()

  for (const a of auctions) {
    const village = a.village.trim()
    const coords = villageLookup.get(village)
    if (coords) {
      // Add slight random offset so markers don't all stack on exact same point
      const jitter = () => (Math.random() - 0.5) * 0.005
      update.run(coords.lat + jitter(), coords.lng + jitter(), a.obs_id)
      matched++
    } else {
      unmatched++
      unmatchedVillages.add(village)
    }
  }

  console.log(`Matched: ${matched}/${auctions.length}`)
  console.log(`Unmatched: ${unmatched}`)
  if (unmatchedVillages.size > 0) {
    console.log(`\nUnmatched village names (${unmatchedVillages.size}):`)
    for (const v of unmatchedVillages) console.log(`  "${v}"`)
  }
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1) })
