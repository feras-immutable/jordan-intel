import Database from "better-sqlite3"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
const db = new Database(join(dirname(fileURLToPath(import.meta.url)), "..", "jordan-intel.db"))

// Find contaminated records
const all = db.prepare(`
  SELECT source_record_id, parcel_number, zoning, description
  FROM observations
  WHERE id IN (SELECT MAX(id) FROM observations GROUP BY source_record_id)
`).all() as any[]

let parcelDirty = 0, zoningDirty = 0, descDirty = 0

for (const c of all) {
  if (c.parcel_number?.includes("Description:")) parcelDirty++
  if (c.zoning?.includes("Apply") || c.zoning?.includes("Discover") || c.zoning?.includes("Meter")) zoningDirty++
  if (c.description?.includes("Apply Now") || c.description?.includes("Discover More")) descDirty++
}

console.log("Total observations:", all.length)
console.log("parcel_number contaminated:", parcelDirty)
console.log("zoning contaminated:", zoningDirty)
console.log("description contaminated:", descDirty)

// Show samples
console.log("\nSample dirty parcel_number:")
all.filter(c => c.parcel_number?.includes("Description:")).slice(0, 5).forEach(c => {
  console.log("  [" + c.parcel_number.slice(0, 80) + "]")
})

console.log("\nSample dirty zoning:")
all.filter(c => c.zoning?.includes("Apply") || c.zoning?.includes("Meter")).slice(0, 5).forEach(c => {
  console.log("  [" + c.zoning.slice(0, 120) + "]")
})

console.log("\nSample dirty description:")
all.filter(c => c.description?.includes("Apply Now")).slice(0, 3).forEach(c => {
  console.log("  [" + c.description.slice(0, 120) + "]")
})
