import { getDb } from "./db.js"
const db = getDb()

console.log("=== BANK VILLAGE NAMES ===")
const bank = db.prepare(`
  SELECT DISTINCT o.village FROM observations o
  JOIN source_records sr ON sr.id = o.source_record_id
  WHERE sr.institution_id = 'housing_bank' AND o.village IS NOT NULL AND o.village != ''
  AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
  LIMIT 15
`).all() as any[]
for (const b of bank) console.log(`  "${b.village}"`)

console.log("\n=== MOJ VILLAGE NAMES ===")
const moj = db.prepare(`
  SELECT DISTINCT o.village FROM observations o
  JOIN source_records sr ON sr.id = o.source_record_id
  WHERE sr.institution_id = 'moj_auctions' AND o.village IS NOT NULL AND o.village != ''
  AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
  LIMIT 15
`).all() as any[]
for (const m of moj) console.log(`  "${m.village}"`)

// Check parcel table for village names
console.log("\n=== PARCEL VILLAGE NAMES ===")
const parcels = db.prepare("SELECT DISTINCT village_name FROM parcels WHERE village_name IS NOT NULL LIMIT 15").all() as any[]
for (const p of parcels) console.log(`  "${p.village_name}"`)
