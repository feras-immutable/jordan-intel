import { getDb } from "./db.js"
const db = getDb()
const counts = db.prepare("SELECT institution_id, COUNT(*) as c FROM source_records GROUP BY institution_id").all() as any[]
console.log("Records by institution:", counts)
const moj = db.prepare("SELECT COUNT(*) as c FROM source_records WHERE institution_id = 'moj_auctions'").get() as any
console.log("MOJ records:", moj.c)
