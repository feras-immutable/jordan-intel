import { getDb } from "./db.js"

const db = getDb()

// Check raw data for any price-related fields
const samples = db.prepare(`
  SELECT sr.source_property_id, sr.raw_data FROM source_records sr
  WHERE sr.institution_id = 'moj_auctions' AND sr.currently_active = 1
  LIMIT 5
`).all() as any[]

for (const s of samples) {
  const raw = JSON.parse(s.raw_data)
  console.log(`${s.source_property_id}:`)
  console.log(`  estimatedValue: ${raw.estimatedValue}`)
  console.log(`  openingValue: ${raw.openingValue}`)
  console.log(`  currentValue: ${raw.currentValue}`)
  console.log(`  bidCount: ${raw.bidCount}`)
  console.log(`  area: ${raw.area}`)
  console.log(`  announcementType: ${raw.announcementType}`)

  // Check if raw text block has any numbers that look like prices
  const text = JSON.stringify(raw)
  const pricePatterns = text.match(/(?:القيمة|المقدرة|الافتتاحي|المبلغ|ثمن|سعر|قيمة)[^"]{0,50}/gi) || []
  if (pricePatterns.length > 0) {
    console.log(`  Price text matches:`)
    for (const p of pricePatterns) console.log(`    ${p}`)
  }
  console.log()
}

// Count how many have any price data
const withPrice = db.prepare(`
  SELECT COUNT(*) as c FROM observations o
  JOIN source_records sr ON sr.id = o.source_record_id
  WHERE sr.institution_id = 'moj_auctions' AND o.price IS NOT NULL AND o.price > 0
  AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
`).get() as any
console.log(`MOJ with price: ${withPrice.c}`)
