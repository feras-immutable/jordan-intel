import axios from "axios"

const PROXY = "https://maps.dls.gov.jo/DotNet/proxy.ashx"
const SERVICE = "https://maps.dls.gov.jo/arcgis/rest/services/DLS/DLS_Cassini/MapServer"
const HEADERS = {
  "Referer": "https://maps.dls.gov.jo/dlsweb/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
}

const ALGOLIA_APP = "LL8IZ711CS"
const ALGOLIA_KEY = "eba05366688fef592618f7defd9f3e7e"
const ALGOLIA_INDEX = "bayut-jo-production-ads-city-level-score-en"

function toWebMercator(lng: number, lat: number) {
  const x = lng * 20037508.34 / 180
  const y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * 20037508.34 / 180
  return { x, y }
}

async function resolveCoordinate(lat: number, lng: number) {
  const { x, y } = toWebMercator(lng, lat)
  const geom = JSON.stringify({ x, y, spatialReference: { wkid: 102100 } })
  const extent = JSON.stringify({
    xmin: x - 50, ymin: y - 50, xmax: x + 50, ymax: y + 50,
    spatialReference: { wkid: 102100 },
  })
  const params = `f=json&geometry=${encodeURIComponent(geom)}&geometryType=esriGeometryPoint&sr=102100&layers=all&tolerance=2&mapExtent=${encodeURIComponent(extent)}&imageDisplay=600,400,96&returnGeometry=false`
  const url = `${PROXY}?${SERVICE}/identify?${params}`

  const r = await axios.get(url, { headers: HEADERS, timeout: 15000 })
  const results = r.data.results || []

  const parcel: Record<string, any> = {}
  for (const result of results) {
    const a = result.attributes
    if (a["رقم قطعة الارض"] && a["رقم قطعة الارض"] !== "Null") {
      parcel.parcel_id = a["رقم قطعة الارض"]
      parcel.dls_key = a["مفتاح قطعة الارض"]
      parcel.vill_code = a["رقم القرية"]
      parcel.hod_code = a["رقم الحوض"]
    }
    if (a["اسم القرية"]) {
      parcel.village_name = a["اسم القرية"]
      parcel.village_name_en = a["VILL_NAME_E"]
      if (!parcel.vill_code) parcel.vill_code = a["رقم القرية"]
    }
    if (a["اسم الحوض"]) {
      parcel.basin_name = a["اسم الحوض"]
      parcel.basin_name_en = a["HOD_NAME_E"]
      if (!parcel.hod_code) parcel.hod_code = a["رقم الحوض"]
    }
    if (a["اسم مديرية التسجيل باللغة العربية"]) {
      parcel.dept_name = a["اسم مديرية التسجيل باللغة العربية"]
      parcel.dept_name_en = a["اسم مديرية التسجيل باللغة الانجليزية"] || a["DIRECTORATE_NAME_E"]
    }
  }
  return parcel
}

async function main() {
  console.log("=== BAYUT → DLS PARCEL RESOLUTION TEST ===\n")

  // Fetch 30 Bayut land listings in Amman with coordinates
  const searchResp = await axios.post(
    `https://${ALGOLIA_APP}-dsn.algolia.net/1/indexes/${ALGOLIA_INDEX}/query`,
    { query: "أرض عمان", hitsPerPage: 30, filters: "purpose:for-sale" },
    {
      headers: {
        "X-Algolia-Application-Id": ALGOLIA_APP,
        "X-Algolia-API-Key": ALGOLIA_KEY,
      },
      timeout: 10000,
    }
  )

  const listings = searchResp.data.hits.filter((h: any) => h._geoloc?.lat && h._geoloc?.lng)
  console.log(`Bayut listings with coordinates: ${listings.length}\n`)

  let fullResolved = 0  // village + basin + parcel
  let partialResolved = 0  // village + basin only
  let failed = 0

  const results: any[] = []

  for (let i = 0; i < listings.length; i++) {
    const hit = listings[i]
    const lat = hit._geoloc.lat
    const lng = hit._geoloc.lng
    const title = (hit.title_l1 || hit.title || "").slice(0, 50)
    const price = hit.price
    const area = hit.area

    process.stdout.write(`${i + 1}/${listings.length} `)

    try {
      const parcel = await resolveCoordinate(lat, lng)

      if (parcel.parcel_id) {
        fullResolved++
        console.log(`✓ FULL — ${title}`)
        console.log(`  ${parcel.village_name} (${parcel.vill_code}) / ${parcel.basin_name} (${parcel.hod_code}) / Parcel ${parcel.parcel_id}`)
        console.log(`  DLS Key: ${parcel.dls_key} | Price: ${price} JOD | Area: ${area}`)
      } else if (parcel.vill_code) {
        partialResolved++
        console.log(`◐ PARTIAL — ${title}`)
        console.log(`  ${parcel.village_name} (${parcel.vill_code}) / ${parcel.basin_name} (${parcel.hod_code}) / No parcel#`)
      } else {
        failed++
        console.log(`✗ NONE — ${title}`)
      }

      results.push({
        id: hit.externalID,
        title,
        price,
        area,
        lat, lng,
        ...parcel,
      })
    } catch (err: any) {
      failed++
      console.log(`✗ ERROR — ${title}: ${err.message}`)
    }
    console.log()
    await new Promise(r => setTimeout(r, 500))
  }

  console.log("\n=== RESULTS ===")
  console.log(`Total tested: ${listings.length}`)
  console.log(`Full resolution (village + basin + parcel): ${fullResolved} (${Math.round(fullResolved / listings.length * 100)}%)`)
  console.log(`Partial (village + basin only): ${partialResolved} (${Math.round(partialResolved / listings.length * 100)}%)`)
  console.log(`Failed/no data: ${failed} (${Math.round(failed / listings.length * 100)}%)`)
  console.log(`\nTotal with at least village+basin: ${fullResolved + partialResolved} (${Math.round((fullResolved + partialResolved) / listings.length * 100)}%)`)
  console.log(`\nCompare to text-parsing: 8%`)

  // Check for DLS key collisions with bank data
  const dlsKeys = results.filter(r => r.dls_key).map(r => r.dls_key)
  if (dlsKeys.length > 0) {
    console.log(`\n=== DLS KEYS FOUND ===`)
    for (const r of results.filter(r => r.dls_key)) {
      console.log(`  ${r.dls_key} — ${r.title} — ${r.price} JOD`)
    }
  }
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1) })
