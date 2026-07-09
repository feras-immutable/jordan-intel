import Database from "better-sqlite3"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const db = new Database(join(dirname(fileURLToPath(import.meta.url)), "..", "jordan-intel.db"))

// Normalize zoning to just the classification, strip trailing descriptions
const allZoning = db.prepare(`
  SELECT id, zoning FROM observations WHERE zoning IS NOT NULL
`).all() as Array<{ id: number; zoning: string }>

const update = db.prepare("UPDATE observations SET zoning = ? WHERE id = ?")
let fixed = 0

for (const o of allZoning) {
  // Extract just the zoning classification
  const match = o.zoning.match(/^(Residential\s*[A-D]|Commercial(?:\s*[A-D])?|Industrial|Agricultural|Rural\s*Residential|Popular\s*Residential|ordinary\s*commercial(?:\/residential)?|local\s*commercial(?:,\s*residential)?|mixed\s*use|craft\s*industries|industrial,\s*craft\s*industries)/i)

  if (match) {
    const clean = match[1].trim()
    if (clean !== o.zoning) {
      update.run(clean, o.id)
      fixed++
    }
  }
}

console.log(`Zoning normalized: ${fixed}`)

// Show results
console.log("\nAll distinct zoning values:")
db.prepare("SELECT DISTINCT zoning, COUNT(*) as c FROM observations WHERE zoning IS NOT NULL GROUP BY zoning ORDER BY c DESC")
  .all().forEach((r: any) => console.log(`  ${r.c}x  ${r.zoning}`))
