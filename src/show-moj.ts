import { getDb } from "./db.js"
const db = getDb()
const auctions = db.prepare(`
  SELECT sr.source_property_id, o.title, o.price, o.area_sqm, o.village, o.basin, o.parcel_number, o.governorate, o.description
  FROM source_records sr
  JOIN observations o ON o.source_record_id = sr.id
  WHERE sr.institution_id = 'moj_auctions' AND sr.currently_active = 1
  AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
`).all() as any[]

console.log(`MOJ auctions: ${auctions.length}\n`)
for (const a of auctions) {
  console.log(`${a.source_property_id}: ${a.title}`)
  console.log(`  Price: ${a.price} | Area: ${a.area_sqm} m²`)
  console.log(`  Gov: ${a.governorate} | Village: ${a.village} | Basin: ${a.basin} | Parcel: ${a.parcel_number}`)
  console.log(`  ${(a.description || "").slice(0, 100)}`)
  console.log()
}
