import Database from "better-sqlite3"
import axios from "axios"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const db = new Database(join(__dirname, "..", "jordan-intel.db"))

async function main() {
  // Get 20 diverse samples
  const samples = db.prepare(`
    SELECT sr.source_property_id, sr.institution_id, sr.source_url,
      o.title, o.price, o.property_type, o.village, o.basin, o.parcel_number,
      o.area_sqm, o.latitude, o.longitude
    FROM source_records sr
    JOIN observations o ON o.source_record_id = sr.id
    WHERE sr.currently_active = 1
    AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
    AND o.parcel_number IS NOT NULL
    ORDER BY RANDOM()
    LIMIT 20
  `).all() as any[]

  console.log("=== 20-PARCEL JOIN TEST ===\n")

  // First, check aradi.io URL structure
  console.log("--- Testing aradi.io URL patterns ---\n")

  // Try the known pattern: aradi.io/plot/{a}/{b}/{c}
  // We need to figure out what a, b, c map to from our data
  const testUrl = "https://aradi.io/plot/111/7/103"
  try {
    const resp = await axios.get(testUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      timeout: 10000,
      maxRedirects: 5,
    })
    console.log(`aradi.io test URL (${testUrl}):`, resp.status, "length:", resp.data.length)
    // Check if it's a real page
    const hasParcel = resp.data.includes("parcel") || resp.data.includes("قطعة") || resp.data.includes("حوض")
    console.log("Looks like a parcel page:", hasParcel)
  } catch (err: any) {
    console.log(`aradi.io test failed:`, err.response?.status || err.message)
  }

  // Check aradi.io for an API or search endpoint
  try {
    const searchUrl = "https://aradi.io/api/search"
    const resp = await axios.get(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 10000,
      validateStatus: () => true,
    })
    console.log(`aradi.io /api/search:`, resp.status)
  } catch (err: any) {
    console.log(`aradi.io API test:`, err.message)
  }

  // Check the official DLS map for API patterns
  console.log("\n--- Testing DLS map API ---\n")
  try {
    const dlsUrl = "https://maps.dls.gov.jo/dlsweb/"
    const resp = await axios.get(dlsUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 15000,
    })
    console.log(`DLS map (${dlsUrl}):`, resp.status, "length:", resp.data.length)

    // Look for API endpoints in the page
    const apiMatches = resp.data.match(/https?:\/\/[^"'\s]+(?:api|service|arcgis|rest|search|query)[^"'\s]*/gi) || []
    console.log("API-like URLs found:", [...new Set(apiMatches)].slice(0, 10))

    // Look for ArcGIS patterns
    const arcgisMatches = resp.data.match(/https?:\/\/[^"'\s]*(?:MapServer|FeatureServer|arcgis)[^"'\s]*/gi) || []
    console.log("ArcGIS URLs:", [...new Set(arcgisMatches)].slice(0, 10))
  } catch (err: any) {
    console.log(`DLS map failed:`, err.message)
  }

  // Now show our 20 samples to understand what join keys we have
  console.log("\n\n=== OUR 20 SAMPLE PROPERTIES ===\n")
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    console.log(`${i + 1}. ${s.source_property_id} [${s.institution_id}] ${s.property_type || "?"}`)
    console.log(`   Title: ${(s.title || "").slice(0, 80)}`)
    console.log(`   Village: ${s.village} | Basin: ${s.basin} | Parcel: ${s.parcel_number}`)
    console.log(`   Price: ${s.price} JOD | Area: ${s.area_sqm} sqm`)
    console.log(`   Coords: ${s.latitude}, ${s.longitude}`)
    console.log()
  }

  // Analyze the parcel number format across all records
  console.log("\n=== PARCEL NUMBER FORMAT ANALYSIS ===\n")
  const allParcels = db.prepare(`
    SELECT o.parcel_number, o.basin, o.village, sr.institution_id
    FROM observations o
    JOIN source_records sr ON sr.id = o.source_record_id
    WHERE sr.currently_active = 1
    AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
    AND o.parcel_number IS NOT NULL
  `).all() as any[]

  // Categorize parcel formats
  const formats: Record<string, number> = {}
  for (const p of allParcels) {
    const pn = p.parcel_number
    if (/^\d+$/.test(pn)) formats["pure_number"] = (formats["pure_number"] || 0) + 1
    else if (/^\d+\/\d+$/.test(pn)) formats["number/number"] = (formats["number/number"] || 0) + 1
    else if (/^\d+[-\/]\d+$/.test(pn)) formats["number-number"] = (formats["number-number"] || 0) + 1
    else formats["other: " + pn.slice(0, 30)] = (formats["other: " + pn.slice(0, 30)] || 0) + 1
  }
  console.log("Parcel number formats:")
  for (const [fmt, count] of Object.entries(formats).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${fmt}: ${count}`)
  }

  // Basin format analysis
  const basinFormats: Record<string, number> = {}
  for (const p of allParcels) {
    const b = p.basin || ""
    if (/^[A-Za-z]/.test(b)) basinFormats["name_only"] = (basinFormats["name_only"] || 0) + 1
    else if (/\(\d+\)/.test(b)) basinFormats["name (number)"] = (basinFormats["name (number)"] || 0) + 1
    else if (/\d+/.test(b)) basinFormats["has_number"] = (basinFormats["has_number"] || 0) + 1
    else basinFormats["other"] = (basinFormats["other"] || 0) + 1
  }
  console.log("\nBasin formats:")
  for (const [fmt, count] of Object.entries(basinFormats).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${fmt}: ${count}`)
  }
}

main().catch(err => {
  console.error("Fatal:", err)
  process.exit(1)
})
