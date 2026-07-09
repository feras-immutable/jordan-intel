import Database from "better-sqlite3"
import axios from "axios"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const db = new Database(join(__dirname, "..", "jordan-intel.db"))

// Show price distribution
const topPrices = db.prepare(`
  SELECT sr.source_property_id, sr.institution_id, sr.source_url, o.price, o.title, o.area_sqm
  FROM source_records sr
  JOIN observations o ON o.source_record_id = sr.id
  WHERE sr.currently_active = 1
  AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
  ORDER BY o.price DESC LIMIT 10
`).all() as any[]

console.log("=== TOP 10 PRICES ===")
for (const p of topPrices) {
  console.log(`${p.price} JOD | ${p.source_property_id} [${p.institution_id}] ${(p.title || "").slice(0, 60)}`)
}

const lowPrices = db.prepare(`
  SELECT sr.source_property_id, sr.institution_id, sr.source_url, o.price, o.title, o.area_sqm
  FROM source_records sr
  JOIN observations o ON o.source_record_id = sr.id
  WHERE sr.currently_active = 1 AND o.price > 0
  AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
  ORDER BY o.price ASC LIMIT 10
`).all() as any[]

console.log("\n=== LOWEST 10 PRICES ===")
for (const p of lowPrices) {
  console.log(`${p.price} JOD | ${p.source_property_id} [${p.institution_id}] ${(p.title || "").slice(0, 60)}`)
}

// Check Housing Bank: compare stored price vs raw data
console.log("\n=== HOUSING BANK: RAW vs STORED PRICE ===")
const hbSamples = db.prepare(`
  SELECT sr.source_property_id, sr.source_url, sr.raw_data, o.price
  FROM source_records sr
  JOIN observations o ON o.source_record_id = sr.id
  WHERE sr.institution_id = 'housing_bank' AND sr.currently_active = 1
  AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
  ORDER BY RANDOM() LIMIT 10
`).all() as any[]

for (const s of hbSamples) {
  const raw = JSON.parse(s.raw_data)
  console.log(`${s.source_property_id}: stored=${s.price} | raw.price="${raw.price}" | url=${s.source_url}`)
}

// Verify against actual bank page for 3 properties
console.log("\n=== VERIFICATION: FETCHING 3 ACTUAL BANK PAGES ===")
const toVerify = db.prepare(`
  SELECT sr.source_property_id, sr.source_url, o.price
  FROM source_records sr
  JOIN observations o ON o.source_record_id = sr.id
  WHERE sr.institution_id = 'housing_bank' AND sr.currently_active = 1
  AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
  AND o.price > 0
  ORDER BY RANDOM() LIMIT 3
`).all() as any[]

for (const v of toVerify) {
  try {
    const resp = await axios.get(v.source_url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      timeout: 15000,
    })
    const html = resp.data
    // Extract price from page
    const jodMatch = html.match(/JOD\s*([0-9,]+)/i) || html.match(/([0-9,]+)\s*JOD/i)
    const pagePrice = jodMatch ? jodMatch[1].replace(/,/g, "") : "NOT_FOUND"
    const match = v.price === parseFloat(pagePrice)
    console.log(`${v.source_property_id}: stored=${v.price} | page_says=${pagePrice} | ${match ? "MATCH" : "MISMATCH"}`)
    console.log(`  URL: ${v.source_url}`)
  } catch (err: any) {
    console.log(`${v.source_property_id}: FETCH FAILED — ${err.message}`)
  }
}

// Check Etihad
console.log("\n=== ETIHAD: RAW vs STORED PRICE ===")
const etSamples = db.prepare(`
  SELECT sr.source_property_id, sr.raw_data, o.price
  FROM source_records sr
  JOIN observations o ON o.source_record_id = sr.id
  WHERE sr.institution_id = 'bank_al_etihad' AND sr.currently_active = 1
  AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
  LIMIT 5
`).all() as any[]

for (const s of etSamples) {
  const raw = JSON.parse(s.raw_data)
  console.log(`${s.source_property_id}: stored=${s.price} | raw.price="${raw.price}"`)
}
