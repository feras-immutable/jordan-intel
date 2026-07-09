import axios from "axios"

const BASE = "https://gisportal.dls.gov.jo/arcgis/rest/services"

async function getJson(url: string): Promise<any> {
  const r = await axios.get(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    timeout: 15000,
    validateStatus: () => true,
  })
  return r.data
}

async function main() {
  console.log("=== GISPORTAL.DLS.GOV.JO EXPLORATION ===\n")

  // Check key folders
  for (const folder of ["DLS", "Just_Parcels", "GAM"]) {
    const data = await getJson(`${BASE}/${folder}?f=json`)
    console.log(`${folder}/`)
    if (data.services) {
      for (const svc of data.services) console.log(`  ${svc.name} (${svc.type})`)
    }
    if (data.error) console.log(`  Error: ${data.error.message}`)
    console.log()
  }

  // Check Just_Parcels specifically — this sounds like exactly what we need
  const jpData = await getJson(`${BASE}/Just_Parcels?f=json`)
  if (jpData.services) {
    for (const svc of jpData.services) {
      console.log(`\n--- ${svc.name}/${svc.type} ---`)
      const svcData = await getJson(`${BASE}/${svc.name}/${svc.type}?f=json`)
      if (svcData.layers) {
        for (const layer of svcData.layers) {
          console.log(`  Layer ${layer.id}: ${layer.name}`)
        }
      }
      if (svcData.error) console.log(`  Error: ${svcData.error.message}`)
    }
  }

  // Check DLS folder services
  const dlsData = await getJson(`${BASE}/DLS?f=json`)
  if (dlsData.services) {
    console.log("\n\n=== DLS SERVICES ===")
    for (const svc of dlsData.services) {
      console.log(`\n--- ${svc.name}/${svc.type} ---`)
      const svcData = await getJson(`${BASE}/${svc.name}/${svc.type}?f=json`)
      if (svcData.layers) {
        for (const layer of svcData.layers.slice(0, 10)) {
          console.log(`  Layer ${layer.id}: ${layer.name}`)
        }
        if (svcData.layers.length > 10) console.log(`  ... and ${svcData.layers.length - 10} more layers`)
      }
      if (svcData.error) console.log(`  Token required: ${svcData.error.message}`)
    }
  }

  // Now the big test: coordinate query on Just_Parcels
  console.log("\n\n=== COORDINATE → PARCEL QUERY ===\n")

  // Test coordinate: a Housing Bank property location
  // AQ-RE-100201: 31.8100278, 36.1096473 (Al-Muwaqqar area)
  const testLat = 31.8100278
  const testLng = 36.1096473

  // Try Just_Parcels services
  if (jpData.services) {
    for (const svc of jpData.services) {
      const svcData = await getJson(`${BASE}/${svc.name}/${svc.type}?f=json`)
      if (!svcData.layers) continue

      for (const layer of svcData.layers.slice(0, 5)) {
        try {
          const queryUrl = `${BASE}/${svc.name}/${svc.type}/${layer.id}/query`
          const r = await getJson(
            queryUrl + `?geometry=${testLng},${testLat}&geometryType=esriGeometryPoint` +
            `&spatialRel=esriSpatialRelIntersects&inSR=4326&outFields=*&returnGeometry=false&f=json`
          )
          if (r.features?.length > 0) {
            console.log(`✓ ${svc.name} Layer ${layer.id} (${layer.name}): ${r.features.length} features!`)
            console.log(`  Attributes: ${JSON.stringify(r.features[0].attributes).slice(0, 500)}`)
          }
        } catch { /* skip */ }
      }
    }
  }

  // Also try identify on any working service
  if (jpData.services) {
    for (const svc of jpData.services) {
      try {
        const identUrl = `${BASE}/${svc.name}/${svc.type}/identify`
        const r = await getJson(
          identUrl + `?geometry=${testLng},${testLat}&geometryType=esriGeometryPoint` +
          `&sr=4326&layers=all&tolerance=5` +
          `&mapExtent=${testLng - 0.01},${testLat - 0.01},${testLng + 0.01},${testLat + 0.01}` +
          `&imageDisplay=600,400,96&returnGeometry=false&f=json`
        )
        if (r.results?.length > 0) {
          console.log(`\n✓ IDENTIFY on ${svc.name}: ${r.results.length} results!`)
          for (const result of r.results.slice(0, 3)) {
            console.log(`  Layer: ${result.layerName}`)
            console.log(`  Attributes: ${JSON.stringify(result.attributes).slice(0, 500)}`)
          }
        }
      } catch { /* skip */ }
    }
  }
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1) })
