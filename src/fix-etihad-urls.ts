import Database from "better-sqlite3"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const db = new Database(join(dirname(fileURLToPath(import.meta.url)), "..", "jordan-intel.db"))

const records = db.prepare(
  "SELECT id, raw_data FROM source_records WHERE institution_id = 'bank_al_etihad'"
).all() as Array<{ id: number; raw_data: string }>

const update = db.prepare("UPDATE source_records SET source_url = ? WHERE id = ?")
let fixed = 0
for (const r of records) {
  const raw = JSON.parse(r.raw_data)
  if (raw.id) {
    update.run("https://www.bankaletihad.com/en/real-estate/form/?id=" + raw.id, r.id)
    fixed++
  }
}
console.log(`Fixed ${fixed} Etihad URLs`)
