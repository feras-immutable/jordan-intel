import { getDb } from "./db.js"
const db = getDb()
const result = db.prepare("UPDATE source_records SET source_url = 'https://auctions.moj.gov.jo/' WHERE institution_id = 'moj_auctions'").run()
console.log(`Fixed ${result.changes} MOJ source URLs`)
