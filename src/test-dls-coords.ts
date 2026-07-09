import axios from "axios"
import * as cheerio from "cheerio"

// Test: can we go from coordinates → parcel via the DLS system?
// DLS map: https://maps.dls.gov.jo/dlsweb/
// It uses ArcGIS JS API 4.20 — there must be a MapServer behind it

async function main() {
  console.log("=== DLS COORDINATE → PARCEL TEST ===\n")

  // Step 1: Inspect the DLS map page for ArcGIS service URLs
  console.log("1. Inspecting DLS map page for service URLs...\n")
  try {
    const resp = await axios.get("https://maps.dls.gov.jo/dlsweb/", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      timeout: 15000,
    })
    const html = resp.data

    // Find all service URLs (MapServer, FeatureServer, etc.)
    const serviceUrls = html.match(/https?:\/\/[^"'\s]+(?:MapServer|FeatureServer|rest\/services)[^"'\s]*/gi) || []
    const uniqueServices = [...new Set(serviceUrls)]
    console.log("ArcGIS service URLs found:", uniqueServices.length)
    for (const u of uniqueServices) console.log("  " + u)

    // Find any other URLs that look like data endpoints
    const dataUrls = html.match(/https?:\/\/maps\.dls\.gov\.jo[^"'\s]*/gi) || []
    const uniqueData = [...new Set(dataUrls)]
    console.log("\nDLS URLs found:", uniqueData.length)
    for (const u of uniqueData) console.log("  " + u)

    // Find any inline JS config for the map layers
    const layerMatches = html.match(/['"](https?:\/\/[^"']*(?:MapServer|FeatureServer)[^"']*)['"]/g) || []
    console.log("\nQuoted service URLs:")
    for (const m of [...new Set(layerMatches)]) console.log("  " + m)

    // Look for any configuration objects
    const configMatches = html.match(/(?:url|serviceUrl|mapUrl|layerUrl)\s*[:=]\s*["']([^"']+)["']/gi) || []
    console.log("\nConfig URLs:")
    for (const m of [...new Set(configMatches)]) console.log("  " + m)
  } catch (err: any) {
    console.log("DLS page fetch failed:", err.message)
  }

  // Step 2: Try common DLS ArcGIS patterns
  console.log("\n2. Testing common ArcGIS endpoint patterns...\n")

  const basePaths = [
    "https://maps.dls.gov.jo/arcgis/rest/services",
    "https://maps.dls.gov.jo/server/rest/services",
    "https://gis.dls.gov.jo/arcgis/rest/services",
    "https://maps.dls.gov.jo/dlsweb/arcgis/rest/services",
  ]

  for (const base of basePaths) {
    try {
      const r = await axios.get(base + "?f=json", {
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 8000,
        validateStatus: () => true,
      })
      console.log(`${base}: ${r.status} (${typeof r.data === "object" ? "JSON" : r.data.length + " bytes"})`)
      if (r.status === 200 && typeof r.data === "object") {
        console.log("  Services:", JSON.stringify(r.data).slice(0, 300))
      }
    } catch (err: any) {
      console.log(`${base}: ${err.message}`)
    }
  }

  // Step 3: Try the Amman GIS ArcGIS (we know this exists)
  console.log("\n3. Testing Amman GIS ArcGIS...\n")

  const ammanPaths = [
    "https://www.ammancitygis.gov.jo/ArcGis/rest/services",
    "https://ammancitygis.gov.jo/ArcGis/rest/services",
  ]

  for (const base of ammanPaths) {
    try {
      const r = await axios.get(base + "?f=json", {
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 10000,
        validateStatus: () => true,
      })
      console.log(`${base}: ${r.status}`)
      if (r.status === 200 && typeof r.data === "object") {
        console.log("  Services:", JSON.stringify(r.data.services || r.data.folders || r.data).slice(0, 500))
      }
    } catch (err: any) {
      console.log(`${base}: ${err.message}`)
    }
  }

  // Step 4: Try querying a known coordinate against any working service
  // Test coordinate: 31.95, 35.93 (central Amman area)
  console.log("\n4. Testing coordinate query...\n")

  const testLat = 31.95
  const testLng = 35.93

  // Try Amman Explorer MapServer identify
  const identifyUrl = "https://www.ammancitygis.gov.jo/ArcGis/rest/services/AMMAN_EXPLORER/MapServer/identify"
  try {
    const r = await axios.get(identifyUrl, {
      params: {
        geometry: `${testLng},${testLat}`,
        geometryType: "esriGeometryPoint",
        sr: 4326,
        layers: "all",
        tolerance: 5,
        mapExtent: `${testLng - 0.01},${testLat - 0.01},${testLng + 0.01},${testLat + 0.01}`,
        imageDisplay: "800,600,96",
        returnGeometry: true,
        f: "json",
      },
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 15000,
    })
    console.log("Amman Explorer identify:", r.status)
    if (r.data?.results) {
      console.log("Results:", r.data.results.length)
      for (const result of r.data.results.slice(0, 3)) {
        console.log(`  Layer: ${result.layerName} (${result.layerId})`)
        console.log(`  Attributes:`, JSON.stringify(result.attributes).slice(0, 300))
      }
    } else {
      console.log("Response:", JSON.stringify(r.data).slice(0, 500))
    }
  } catch (err: any) {
    console.log("Amman identify failed:", err.response?.status || err.message)
  }

  // Try query on specific layer
  const queryUrl = "https://www.ammancitygis.gov.jo/ArcGis/rest/services/AMMAN_EXPLORER/MapServer/0/query"
  try {
    const r = await axios.get(queryUrl, {
      params: {
        geometry: `${testLng},${testLat}`,
        geometryType: "esriGeometryPoint",
        spatialRel: "esriSpatialRelIntersects",
        inSR: 4326,
        outFields: "*",
        returnGeometry: true,
        f: "json",
      },
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 15000,
    })
    console.log("\nAmman Explorer layer 0 query:", r.status)
    if (r.data?.features) {
      console.log("Features:", r.data.features.length)
      for (const f of r.data.features.slice(0, 2)) {
        console.log("  Attributes:", JSON.stringify(f.attributes).slice(0, 400))
      }
    } else {
      console.log("Response:", JSON.stringify(r.data).slice(0, 500))
    }
  } catch (err: any) {
    console.log("Layer 0 query failed:", err.response?.status || err.message)
  }

  // Try layers 0-10
  console.log("\n5. Scanning Amman Explorer layers...\n")
  for (let i = 0; i <= 15; i++) {
    const layerUrl = `https://www.ammancitygis.gov.jo/ArcGis/rest/services/AMMAN_EXPLORER/MapServer/${i}`
    try {
      const r = await axios.get(layerUrl + "?f=json", {
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 8000,
        validateStatus: () => true,
      })
      if (r.status === 200 && r.data?.name) {
        console.log(`  Layer ${i}: ${r.data.name} (${r.data.type})`)
        if (r.data.fields) {
          const fieldNames = r.data.fields.map((f: any) => f.name).join(", ")
          console.log(`    Fields: ${fieldNames.slice(0, 200)}`)
        }
      }
    } catch { /* skip */ }
  }
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1) })
