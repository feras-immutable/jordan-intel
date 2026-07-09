import axios from "axios"

const PROXY = "https://maps.dls.gov.jo/DotNet/proxy.ashx"
const SERVICE = "https://maps.dls.gov.jo/arcgis/rest/services/DLS/DLS_Cassini/MapServer"
const HEADERS = {
  "Referer": "https://maps.dls.gov.jo/dlsweb/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
}

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
    // Parcel layer
    if (a["رقم قطعة الارض"] && a["رقم قطعة الارض"] !== "Null") {
      parcel.parcel_id = a["رقم قطعة الارض"]
      parcel.dls_key = a["مفتاح قطعة الارض"]
      parcel.vill_code = a["رقم القرية"]
      parcel.hod_code = a["رقم الحوض"]
    }
    // Village layer
    if (a["اسم القرية"]) {
      parcel.village_name = a["اسم القرية"]
      parcel.village_name_en = a["VILL_NAME_E"]
      if (!parcel.vill_code) parcel.vill_code = a["رقم القرية"]
    }
    // Basin layer
    if (a["اسم الحوض"]) {
      parcel.basin_name = a["اسم الحوض"]
      parcel.basin_name_en = a["HOD_NAME_E"]
      if (!parcel.hod_code) parcel.hod_code = a["رقم الحوض"]
    }
    // District layer
    if (a["اسم مديرية التسجيل باللغة العربية"]) {
      parcel.dept_name = a["اسم مديرية التسجيل باللغة العربية"]
      parcel.dept_name_en = a["اسم مديرية التسجيل باللغة الانجليزية"]
    }
  }
  return parcel
}

async function main() {
  console.log("=== DLS COORDINATE → PARCEL RESOLVER TEST ===\n")

  const testCoords = [
    { lat: 31.8553333, lng: 35.9992584, label: "Sahab (Housing Bank AQ-BLD-100095)" },
    { lat: 31.9863611, lng: 35.9621195, label: "Tubna (Housing Bank AQ-RE-100549)" },
    { lat: 32.0581111, lng: 35.7194251, label: "Al-Salt (Housing Bank AQ-RE-100656)" },
    { lat: 32.5490833, lng: 35.8707862, label: "Irbid (Housing Bank AQ-RE-100032)" },
    { lat: 31.712528, lng: 35.782972, label: "Etihad AP-0031" },
    { lat: 31.962639, lng: 36.073056, label: "Etihad LD-0026" },
  ]

  let resolved = 0
  for (const tc of testCoords) {
    console.log(`${tc.label} (${tc.lat}, ${tc.lng})`)
    try {
      const result = await resolveCoordinate(tc.lat, tc.lng)
      if (result.vill_code || result.village_name) {
        resolved++
        console.log(`  ✓ Village: ${result.vill_code} ${result.village_name || ""} (${result.village_name_en || ""})`)
        console.log(`    Basin: ${result.hod_code} ${result.basin_name || ""} (${result.basin_name_en || ""})`)
        console.log(`    Parcel: ${result.parcel_id || "—"} | DLS Key: ${result.dls_key || "—"}`)
        console.log(`    Dept: ${result.dept_name || ""} (${result.dept_name_en || ""})`)
      } else {
        console.log(`  ✗ No parcel data returned`)
      }
    } catch (err: any) {
      console.log(`  ERROR: ${err.message}`)
    }
    console.log()
    await new Promise(r => setTimeout(r, 500))
  }

  console.log(`\n=== RESULT: ${resolved}/${testCoords.length} resolved ===`)
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1) })
