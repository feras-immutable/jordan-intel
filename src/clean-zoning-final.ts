import Database from "better-sqlite3"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
const db = new Database(join(dirname(fileURLToPath(import.meta.url)), "..", "jordan-intel.db"))
db.prepare("UPDATE observations SET zoning = 'Residential' WHERE zoning LIKE 'Residential, Private%'").run()
db.prepare("UPDATE observations SET zoning = 'Residential' WHERE zoning = 'residential.'").run()
db.prepare("UPDATE observations SET zoning = 'Industrial' WHERE zoning = 'industrial'").run()
db.prepare("UPDATE observations SET zoning = 'Commercial' WHERE zoning = 'commercial'").run()
console.log("Done. Current zoning values:")
const rows = db.prepare("SELECT DISTINCT zoning, COUNT(*) as c FROM observations WHERE zoning IS NOT NULL GROUP BY zoning ORDER BY c DESC").all() as any[]
for (const r of rows) console.log(`  ${r.c}x  ${r.zoning}`)
