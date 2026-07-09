import axios from "axios"

const DLS_BASE = "https://maps.dls.gov.jo/arcgis/rest/services"

async function tryUrl(url: string, label: string) {
  try {
    const r = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 12000,
      validateStatus: () => true,
    })
    const isJson = typeof r.data === "object"
    console.log(`${label}: ${r.status} ${isJson ? "JSON" : r.data?.length + "b"}`)
    if (isJson) console.log("  " + JSON.stringify(r.data).slice(0, 400))
    return r.data
  } catch (err: any) {
    console.log(`${label}: ${err.message}`)
    return null
  }
}

async function main() {
  console.log("=== DLS ARCGIS DEEP INSPECTION ===\n")

  // Check Utilities folder
  await tryUrl(DLS_BASE + "/Utilities?f=json", "Utilities folder")
  console.log()

  // Try common DLS map service names
  const names = [
    "DLS", "Parcels", "Lands", "LandParcels", "Survey", "Cadastral",
    "DLS_Map", "DLS_Parcels", "DLS_Lands", "LandsAndSurvey",
    "ParcelMap", "LandMap", "DLSWEB", "dlsweb",
    "Jordan", "Jordan_Parcels", "JordanLand",
    "SmartPlan", "Smart_Plan",
  ]

  console.log("Testing MapServer service names...")
  for (const name of names) {
    const url = `${DLS_BASE}/${name}/MapServer?f=json`
    try {
      const r = await axios.get(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 5000,
        validateStatus: () => true,
      })
      if (r.status === 200) {
        console.log(`  ✓ ${name}: ${r.status} — ${JSON.stringify(r.data).slice(0, 200)}`)
      }
    } catch { /* skip */ }
  }

  // Check for FeatureServer versions too
  console.log("\nTesting FeatureServer service names...")
  for (const name of names.slice(0, 10)) {
    const url = `${DLS_BASE}/${name}/FeatureServer?f=json`
    try {
      const r = await axios.get(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 5000,
        validateStatus: () => true,
      })
      if (r.status === 200) {
        console.log(`  ✓ ${name}: ${r.status} — ${JSON.stringify(r.data).slice(0, 200)}`)
      }
    } catch { /* skip */ }
  }

  // Check Utilities subfolder services
  console.log("\nChecking Utilities services...")
  const utilNames = ["Geometry", "PrintingTools", "Printing", "GPServer"]
  for (const name of utilNames) {
    await tryUrl(`${DLS_BASE}/Utilities/${name}/GPServer?f=json`, `Utilities/${name}`)
  }

  // The DLS web map probably loads JS that configures the layers
  // Let's check for JS files that might contain service URLs
  console.log("\n\nChecking DLS web app JS files...")
  try {
    const mainResp = await axios.get("https://maps.dls.gov.jo/dlsweb/", {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 15000,
    })
    // Find JS files
    const jsFiles = mainResp.data.match(/src=["']([^"']+\.js[^"']*)/g) || []
    console.log("JS files found:", jsFiles.length)
    for (const js of jsFiles.slice(0, 5)) {
      const jsUrl = js.replace(/src=["']/, "")
      const fullUrl = jsUrl.startsWith("http") ? jsUrl : `https://maps.dls.gov.jo/dlsweb/${jsUrl}`
      console.log("  " + fullUrl)

      // Fetch and search for service URLs
      if (!fullUrl.includes("arcgis.com") && !fullUrl.includes("cdn")) {
        try {
          const jsResp = await axios.get(fullUrl, { timeout: 10000 })
          const serviceMatches = jsResp.data.match(/https?:\/\/[^"'\s]+(?:MapServer|FeatureServer|rest\/services)[^"'\s]*/gi) || []
          if (serviceMatches.length > 0) {
            console.log("    Service URLs in JS:")
            for (const s of [...new Set(serviceMatches)].slice(0, 5)) {
              console.log("      " + s)
            }
          }
          // Also look for layer config patterns
          const layerConfigs = jsResp.data.match(/url\s*:\s*["']([^"']*(?:MapServer|FeatureServer)[^"']*)/gi) || []
          if (layerConfigs.length > 0) {
            console.log("    Layer configs in JS:")
            for (const l of [...new Set(layerConfigs)]) {
              console.log("      " + l)
            }
          }
        } catch { /* skip */ }
      }
    }
  } catch (err: any) {
    console.log("DLS web app check failed:", err.message)
  }

  // Also try the DLS map API directly (the map app might use a proxy)
  console.log("\n\nTrying DLS proxy/API patterns...")
  const proxyPaths = [
    "https://maps.dls.gov.jo/dlsweb/api/parcel",
    "https://maps.dls.gov.jo/dlsweb/api/search",
    "https://maps.dls.gov.jo/dlsweb/proxy",
    "https://maps.dls.gov.jo/dlsweb/api/identify",
  ]
  for (const url of proxyPaths) {
    await tryUrl(url + "?f=json", url.split("/").pop() || url)
  }
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1) })
