import { getDb } from "./db.js"
const db = getDb()

console.log("=== RECORD RECONCILIATION ===\n")

const byInst = db.prepare("SELECT institution_id, COUNT(*) as c FROM source_records GROUP BY institution_id").all() as any[]
let total = 0
for (const r of byInst) { console.log(`${r.institution_id}: ${r.c}`); total += r.c }
console.log(`Total source records: ${total}`)

const active = db.prepare("SELECT COUNT(*) as c FROM source_records WHERE currently_active = 1").get() as any
console.log(`Active: ${active.c}`)
console.log(`Inactive: ${total - active.c}`)

// Check for MOJ duplicates
const mojDupes = db.prepare(`
  SELECT source_property_id, COUNT(*) as c FROM source_records
  WHERE institution_id = 'moj_auctions' GROUP BY source_property_id HAVING COUNT(*) > 1
`).all() as any[]
console.log(`\nMOJ duplicate source_property_ids: ${mojDupes.length}`)
for (const d of mojDupes.slice(0, 5)) console.log(`  ${d.source_property_id}: ${d.c} records`)

// Check observation counts
const obsCount = db.prepare("SELECT COUNT(*) as c FROM observations").get() as any
console.log(`\nTotal observations: ${obsCount.c}`)

// Parcels
const parcels = db.prepare("SELECT resolution_status, COUNT(*) as c FROM parcels GROUP BY resolution_status").all() as any[]
console.log("\nParcels by status:")
for (const p of parcels) console.log(`  ${p.resolution_status}: ${p.c}`)
