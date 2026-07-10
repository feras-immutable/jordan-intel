import { getDb } from "./db.js"
const db = getDb()

const withCoords = db.prepare(`
  SELECT COUNT(*) as c FROM observations o
  JOIN source_records sr ON sr.id = o.source_record_id
  WHERE sr.institution_id = 'moj_auctions' AND o.latitude IS NOT NULL
`).get() as any

const latestWithCoords = db.prepare(`
  SELECT COUNT(*) as c FROM observations o
  JOIN source_records sr ON sr.id = o.source_record_id
  WHERE sr.institution_id = 'moj_auctions' AND o.latitude IS NOT NULL
  AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
`).get() as any

const total = db.prepare(`
  SELECT COUNT(*) as c FROM source_records WHERE institution_id = 'moj_auctions' AND currently_active = 1
`).get() as any

console.log("MOJ total active:", total.c)
console.log("Any observation with coords:", withCoords.c)
console.log("Latest observation with coords:", latestWithCoords.c)

// Check a sample
const sample = db.prepare(`
  SELECT o.id, o.latitude, o.longitude, o.village FROM observations o
  JOIN source_records sr ON sr.id = o.source_record_id
  WHERE sr.institution_id = 'moj_auctions' AND o.latitude IS NOT NULL
  LIMIT 3
`).all() as any[]
console.log("\nSample coords:", sample)
