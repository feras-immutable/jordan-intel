import axios from "axios"
import { getDb } from "./db.js"

const PROXY = "https://maps.dls.gov.jo/DotNet/proxy.ashx"
const SERVICE = "https://maps.dls.gov.jo/arcgis/rest/services/DLS/DLS_Cassini/MapServer"
const HEADERS = { "Referer": "https://maps.dls.gov.jo/dlsweb/", "User-Agent": "Mozilla/5.0" }

async function main() {
  const db = getDb()

  // Get a few sample MOJ auctions with their village/basin
  const samples = db.prepare(`
    SELECT o.village, o.basin, o.parcel_number FROM observations o
    JOIN source_records sr ON sr.id = o.source_record_id
    WHERE sr.institution_id = 'moj_auctions' AND sr.currently_active = 1
    AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
    AND o.village IS NOT NULL AND o.village != ''
    LIMIT 5
  `).all() as any[]

  console.log("Sample MOJ villages:")
  for (const s of samples) {
    console.log(`  Village: "${s.village}" | Basin: "${s.basin}" | Parcel: "${s.parcel_number}"`)
  }

  // Try to query DLS for the first village
  if (samples[0]) {
    const name = samples[0].village.trim()
    console.log(`\nSearching DLS for village: "${name}"`)

    // Try exact match
    const url1 = `${PROXY}?${SERVICE}/6/query?f=json&where=${encodeURIComponent(`VILL_NAME_A='${name}'`)}&outFields=*&returnGeometry=false`
    try {
      const r = await axios.get(url1, { headers: HEADERS, timeout: 10000 })
      console.log(`Exact match: ${r.data.features?.length || 0} results`)
      if (r.data.features?.[0]) console.log("  ", JSON.stringify(r.data.features[0].attributes).slice(0, 200))
      if (r.data.error) console.log("  Error:", r.data.error.message)
    } catch (e: any) { console.log("  Failed:", e.message) }

    // Try LIKE match
    const url2 = `${PROXY}?${SERVICE}/6/query?f=json&where=${encodeURIComponent(`VILL_NAME_A LIKE '%${name}%'`)}&outFields=*&returnGeometry=false&resultRecordCount=3`
    try {
      const r = await axios.get(url2, { headers: HEADERS, timeout: 10000 })
      console.log(`LIKE match: ${r.data.features?.length || 0} results`)
      for (const f of (r.data.features || []).slice(0, 3)) {
        console.log("  ", f.attributes.VILL_CODE, f.attributes.VILL_NAME_A, f.attributes.VILL_NAME_E)
      }
      if (r.data.error) console.log("  Error:", r.data.error.message)
    } catch (e: any) { console.log("  Failed:", e.message) }

    // Try getting ALL villages to check field name
    const url3 = `${PROXY}?${SERVICE}/6/query?f=json&where=1=1&outFields=VILL_CODE,VILL_NAME_A,VILL_NAME_E&returnGeometry=false&resultRecordCount=5`
    try {
      const r = await axios.get(url3, { headers: HEADERS, timeout: 10000 })
      console.log(`\nAll villages sample: ${r.data.features?.length || 0} results`)
      for (const f of (r.data.features || []).slice(0, 5)) {
        console.log("  ", f.attributes.VILL_CODE, `"${f.attributes.VILL_NAME_A}"`, f.attributes.VILL_NAME_E)
      }
      if (r.data.error) console.log("  Error:", r.data.error.message)
    } catch (e: any) { console.log("  Failed:", e.message) }
  }
}

main().catch(err => console.error("Fatal:", err.message))
