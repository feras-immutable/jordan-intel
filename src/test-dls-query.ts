import axios from "axios"

const BASE = "https://maps.dls.gov.jo/arcgis/rest/services"

async function tryUrl(url: string, label: string) {
  try {
    const r = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 15000,
      validateStatus: () => true,
    })
    const isJson = typeof r.data === "object"
    console.log(`${label}: ${r.status}`)
    if (isJson) console.log("  " + JSON.stringify(r.data).slice(0, 500))
    return r.data
  } catch (err: any) {
    console.log(`${label}: ${err.message}`)
    return null
  }
}

async function main() {
  console.log("=== DLS PARCEL SERVICE DISCOVERY ===\n")

  // Check the DLS folder
  await tryUrl(`${BASE}/DLS?f=json`, "DLS folder")
  console.log()

  // Check the known services
  const services = ["DLS/DLS_Cassini", "DLS/DLS_JTM"]
  for (const svc of services) {
    console.log(`--- ${svc} ---`)
    const data = await tryUrl(`${BASE}/${svc}/MapServer?f=json`, `${svc}/MapServer`)

    if (data?.layers) {
      console.log("\nLayers:")
      for (const layer of data.layers) {
        console.log(`  ${layer.id}: ${layer.name} (${layer.type || ""})`)
      }
    }
    console.log()
  }

  // Now try to query with a coordinate
  // Test point: 31.95, 35.93 (Amman area)
  const testLat = 31.95
  const testLng = 35.93

  console.log(`\n=== COORDINATE QUERY TEST (${testLat}, ${testLng}) ===\n`)

  for (const svc of services) {
    // Try identify
    const identifyUrl = `${BASE}/${svc}/MapServer/identify`
    console.log(`Identify on ${svc}:`)
    try {
      const r = await axios.get(identifyUrl, {
        params: {
          geometry: JSON.stringify({ x: testLng, y: testLat, spatialReference: { wkid: 4326 } }),
          geometryType: "esriGeometryPoint",
          sr: 4326,
          layers: "all",
          tolerance: 3,
          mapExtent: `${testLng - 0.01},${testLat - 0.01},${testLng + 0.01},${testLat + 0.01}`,
          imageDisplay: "600,400,96",
          returnGeometry: true,
          f: "json",
        },
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 20000,
      })
      if (r.data?.results?.length > 0) {
        console.log(`  ✓ ${r.data.results.length} results!`)
        for (const result of r.data.results.slice(0, 5)) {
          console.log(`\n  Layer: ${result.layerName} (#${result.layerId})`)
          console.log(`  Attributes:`, JSON.stringify(result.attributes).slice(0, 500))
          if (result.geometry) {
            console.log(`  Has geometry: yes (${result.geometryType})`)
          }
        }
      } else {
        console.log(`  No results. Response:`, JSON.stringify(r.data).slice(0, 300))
      }
    } catch (err: any) {
      console.log(`  Failed:`, err.response?.status || err.message)
    }
    console.log()

    // Also try query on each layer
    const svcData = await tryUrl(`${BASE}/${svc}/MapServer?f=json`, "  layer list")
    if (svcData?.layers) {
      for (const layer of svcData.layers.slice(0, 5)) {
        try {
          const qUrl = `${BASE}/${svc}/MapServer/${layer.id}/query`
          const r = await axios.get(qUrl, {
            params: {
              geometry: `${testLng},${testLat}`,
              geometryType: "esriGeometryPoint",
              spatialRel: "esriSpatialRelIntersects",
              inSR: 4326,
              outFields: "*",
              returnGeometry: false,
              f: "json",
            },
            headers: { "User-Agent": "Mozilla/5.0" },
            timeout: 15000,
          })
          if (r.data?.features?.length > 0) {
            console.log(`  ✓ Layer ${layer.id} (${layer.name}): ${r.data.features.length} features`)
            console.log(`    Attributes:`, JSON.stringify(r.data.features[0].attributes).slice(0, 500))
          }
        } catch { /* skip */ }
      }
    }
  }
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1) })
