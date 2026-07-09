import Database from "better-sqlite3"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const db = new Database(join(dirname(fileURLToPath(import.meta.url)), "..", "jordan-intel.db"))

function cleanField(val: string | null): string | null {
  if (!val) return null
  return val
    .replace(/\s*Apply\s*Now.*/i, "")
    .replace(/\s*Discover\s*More.*/i, "")
    .replace(/\s*Reference\s*Number.*/i, "")
    .replace(/\s*Area\s*:\s*\d+\s*Meter.*/i, "")
    .replace(/\s*Land\s*Area\s*:\s*\d+\s*Meter.*/i, "")
    .trim() || null
}

function cleanParcelNumber(val: string | null): string | null {
  if (!val) return null
  // Strip "Description:" and everything after it
  const cleaned = val.replace(/\s*Description:.*/i, "").trim()
  // Should be just a number or number/number
  const match = cleaned.match(/^-?(\d+)(?:\/(\d+))?$/)
  if (match) return match[0].replace(/^-/, "")
  return cleaned || null
}

function cleanDescription(val: string | null): string | null {
  if (!val) return null
  return val
    .replace(/^Description:\s*/i, "")
    .replace(/\s*Apply\s*Now.*/i, "")
    .replace(/\s*Discover\s*More.*/i, "")
    .replace(/\s*Area\s*:\s*\d+\s*Meter.*/i, "")
    .replace(/\s*Land\s*Area\s*:\s*\d+\s*Meter.*/i, "")
    .trim() || null
}

function cleanZoning(val: string | null): string | null {
  if (!val) return null
  let cleaned = val
    .replace(/\s*Apply\s*Now.*/i, "")
    .replace(/\s*Discover\s*More.*/i, "")
    .replace(/,?\s*land\s*area\s*:\s*[\d,.]+\s*(?:sqm|sq|m²|m2)?.*/i, "")
    .replace(/,?\s*total\s*building\s*area\s*:\s*[\d,.]+\s*(?:sqm|sq|m²|m2)?.*/i, "")
    .replace(/\s*Sqm.*/i, "")
    .trim()
  // Keep only the actual zoning classification
  return cleaned || null
}

console.log("=== CLEANING CONTAMINATED DATA ===\n")

const allObs = db.prepare(`
  SELECT id, parcel_number, zoning, description
  FROM observations
`).all() as Array<{ id: number; parcel_number: string | null; zoning: string | null; description: string | null }>

const updateObs = db.prepare(`
  UPDATE observations SET parcel_number = ?, zoning = ?, description = ? WHERE id = ?
`)

let parcelFixed = 0, zoningFixed = 0, descFixed = 0

for (const o of allObs) {
  const newParcel = cleanParcelNumber(o.parcel_number)
  const newZoning = cleanZoning(o.zoning)
  const newDesc = cleanDescription(o.description)

  const changed = newParcel !== o.parcel_number || newZoning !== o.zoning || newDesc !== o.description

  if (changed) {
    if (newParcel !== o.parcel_number) parcelFixed++
    if (newZoning !== o.zoning) zoningFixed++
    if (newDesc !== o.description) descFixed++
    updateObs.run(newParcel, newZoning, newDesc, o.id)
  }
}

console.log(`Parcel numbers cleaned: ${parcelFixed}`)
console.log(`Zoning fields cleaned: ${zoningFixed}`)
console.log(`Descriptions cleaned: ${descFixed}`)

// Verify
console.log("\n=== VERIFICATION ===")
const stillDirty = db.prepare(`
  SELECT COUNT(*) as c FROM observations
  WHERE parcel_number LIKE '%Description:%'
  OR zoning LIKE '%Apply%'
  OR zoning LIKE '%Discover%'
  OR description LIKE '%Apply Now%'
`).get() as { c: number }
console.log(`Still contaminated: ${stillDirty.c}`)

// Show sample cleaned results
console.log("\nSample cleaned parcel numbers:")
db.prepare(`SELECT DISTINCT parcel_number FROM observations WHERE parcel_number IS NOT NULL ORDER BY RANDOM() LIMIT 10`)
  .all().forEach((r: any) => console.log("  " + r.parcel_number))

console.log("\nSample cleaned zoning:")
db.prepare(`SELECT DISTINCT zoning FROM observations WHERE zoning IS NOT NULL ORDER BY RANDOM() LIMIT 10`)
  .all().forEach((r: any) => console.log("  " + r.zoning))
