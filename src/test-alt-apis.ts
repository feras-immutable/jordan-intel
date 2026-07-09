import axios from "axios"

async function main() {
  // Try gisportal.dls.gov.jo
  const bases = [
    "https://gisportal.dls.gov.jo/arcgis/rest/services",
    "https://gisportal.dls.gov.jo/server/rest/services",
  ]
  for (const base of bases) {
    try {
      const r = await axios.get(base + "?f=json", { timeout: 10000, validateStatus: () => true })
      console.log(base + ": " + r.status)
      if (typeof r.data === "object") console.log("  " + JSON.stringify(r.data).slice(0, 500))
    } catch (e: any) { console.log(base + ": " + e.message) }
  }

  // Try aradi.io coordinate lookups
  console.log("\n--- aradi.io API tests ---")
  const aradiPaths = [
    "/api/v1/plot/by-coords?lat=31.95&lng=35.93",
    "/api/plot?lat=31.95&lng=35.93",
    "/api/search?lat=31.95&lng=35.93",
    "/api/v1/search?lat=31.95&lng=35.93",
    "/api/parcel?lat=31.95&lng=35.93",
  ]
  for (const path of aradiPaths) {
    try {
      const r = await axios.get("https://aradi.io" + path, {
        timeout: 8000,
        validateStatus: () => true,
        headers: { "User-Agent": "Mozilla/5.0" },
      })
      console.log(path + ": " + r.status)
      if (r.status === 200 && typeof r.data === "object") {
        console.log("  " + JSON.stringify(r.data).slice(0, 300))
      }
    } catch (e: any) { console.log(path + ": " + e.message) }
  }

  // Try dlsjo.pro coordinate lookups
  console.log("\n--- dlsjo.pro API tests ---")
  const dlsjoPaths = [
    "/api/plot?lat=31.95&lng=35.93",
    "/api/search?lat=31.95&lng=35.93",
    "/api/v1/parcel?lat=31.95&lng=35.93",
  ]
  for (const path of dlsjoPaths) {
    try {
      const r = await axios.get("https://dlsjo.pro" + path, {
        timeout: 8000,
        validateStatus: () => true,
        headers: { "User-Agent": "Mozilla/5.0" },
      })
      console.log(path + ": " + r.status)
      if (r.status === 200 && typeof r.data === "object") {
        console.log("  " + JSON.stringify(r.data).slice(0, 300))
      }
    } catch (e: any) { console.log(path + ": " + e.message) }
  }

  // Check how aradi.io's map works — it must have a tile or data service
  console.log("\n--- aradi.io page inspection ---")
  try {
    const r = await axios.get("https://aradi.io/plot/130/1/6217", {
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    // Find any API calls in the page
    const apis = r.data.match(/https?:\/\/[^"'\s]+(?:api|tiles|service|query)[^"'\s]*/gi) || []
    console.log("API URLs in aradi plot page:", [...new Set(apis)].slice(0, 10))

    // Find any map tile/data source URLs
    const mapUrls = r.data.match(/https?:\/\/[^"'\s]+(?:arcgis|mapserver|geoserver|wms|wmts|pbf|mvt)[^"'\s]*/gi) || []
    console.log("Map data URLs:", [...new Set(mapUrls)].slice(0, 10))

    // Find any JSON data embedded
    const jsonBlocks = r.data.match(/\{[^{}]*"lat"[^{}]*"lng"[^{}]*\}/g) || []
    console.log("Coord JSON blocks:", jsonBlocks.slice(0, 3))
  } catch (e: any) { console.log("aradi plot fetch: " + e.message) }
}

main().catch(err => console.error("Fatal:", err.message))
