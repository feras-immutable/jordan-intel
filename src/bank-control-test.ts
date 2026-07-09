import axios from "axios"
import Database from "better-sqlite3"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const db = new Database(join(__dirname, "..", "jordan-intel.db"))

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

  const parcel: Record<string, any> = {}
  for (const result of (r.data.results || [])) {
    const a = result.attributes
    if (a["رقم قطعة الارض"] && a["رقم قطعة الارض"] !== "Null") {
      parcel.parcel_id = a["رقم قطعة الارض"]?.trim()
      parcel.dls_key = a["مفتاح قطعة الارض"]?.trim()
      parcel.vill_code = a["رقم القرية"]?.trim()
      parcel.hod_code = a["رقم الحوض"]?.trim()
    }
    if (a["اسم القرية"]) parcel.village_name = a["اسم القرية"]
    if (a["VILL_NAME_E"]) parcel.village_name_en = a["VILL_NAME_E"]
    if (a["اسم الحوض"]) parcel.basin_name = a["اسم الحوض"]
    if (a["HOD_NAME_E"]) parcel.basin_name_en = a["HOD_NAME_E"]
    // Also grab from village/basin layers if parcel layer didn't have codes
    if (!parcel.vill_code && a["رقم القرية"] && a["رقم القرية"] !== "Null") {
      parcel.vill_code = a["رقم القرية"]?.trim()
    }
    if (!parcel.hod_code && a["رقم الحوض"] && a["رقم الحوض"] !== "Null") {
      parcel.hod_code = a["رقم الحوض"]?.trim()
    }
  }
  return parcel
}

async function main() {
  console.log("=== BANK CONTROL TEST: DLS Resolver vs Known Parcel Data ===\n")

  // Get bank properties where we KNOW the village_id, basin_id, and parcel_number
  const controls = db.prepare(`
    SELECT sr.source_property_id, sr.institution_id,
      o.latitude, o.longitude, o.village, o.basin, o.parcel_number, o.title,
      p.village_id as known_village_id, p.basin_id as known_basin_id,
      p.parcel_number as known_parcel, p.canonical_key,
      i.name_en as bank_name
    FROM source_records sr
    JOIN observations o ON o.source_record_id = sr.id
      AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
    JOIN source_record_parcels srp ON srp.source_record_id = sr.id
    JOIN parcels p ON p.id = srp.parcel_id
    JOIN institutions i ON i.id = sr.institution_id
    WHERE sr.currently_active = 1
      AND o.latitude IS NOT NULL AND o.longitude IS NOT NULL
      AND p.village_id IS NOT NULL AND p.basin_id IS NOT NULL AND p.parcel_number IS NOT NULL
    ORDER BY RANDOM()
    LIMIT 30
  `).all() as any[]

  console.log(`Testing ${controls.length} bank properties with known parcel identity\n`)

  let villageCorrect = 0
  let basinCorrect = 0
  let parcelCorrect = 0
  let allCorrect = 0
  let dlsReturned = 0
  let noResult = 0

  for (let i = 0; i < controls.length; i++) {
    const c = controls[i]
    process.stdout.write(`${i + 1}/${controls.length} ${c.source_property_id}: `)

    try {
      const dls = await resolveCoordinate(c.latitude, c.longitude)

      if (!dls.vill_code && !dls.village_name) {
        noResult++
        console.log("NO DLS RESULT")
        continue
      }
      dlsReturned++

      // Compare: strip leading zeros for comparison
      const dlsVill = parseInt(dls.vill_code || "0")
      const dlsBasin = parseInt(dls.hod_code || "0")
      const dlsParcel = parseInt(dls.parcel_id || "0")

      const knownVill = c.known_village_id
      const knownBasin = c.known_basin_id
      const knownParcel = c.known_parcel

      const vMatch = dlsVill === knownVill
      const bMatch = dlsBasin === knownBasin
      const pMatch = dlsParcel > 0 && dlsParcel === knownParcel

      if (vMatch) villageCorrect++
      if (bMatch) basinCorrect++
      if (pMatch) parcelCorrect++
      if (vMatch && bMatch && pMatch) allCorrect++

      const status = vMatch && bMatch && pMatch ? "✓ ALL MATCH"
        : vMatch && bMatch ? "◐ Village+Basin match, parcel differs"
        : "✗ MISMATCH"

      console.log(status)
      if (status !== "✓ ALL MATCH") {
        console.log(`  Known:  V=${knownVill} B=${knownBasin} P=${knownParcel} (${c.canonical_key})`)
        console.log(`  DLS:    V=${dlsVill} B=${dlsBasin} P=${dlsParcel || "none"} (${dls.village_name} / ${dls.basin_name})`)
      }
    } catch (err: any) {
      noResult++
      console.log(`ERROR: ${err.message}`)
    }

    await new Promise(r => setTimeout(r, 500))
  }

  console.log("\n=== CONTROL TEST RESULTS ===")
  console.log(`Tested: ${controls.length}`)
  console.log(`DLS returned data: ${dlsReturned}`)
  console.log(`No DLS result: ${noResult}`)
  console.log()
  console.log(`Village correct: ${villageCorrect}/${dlsReturned} (${Math.round(villageCorrect / dlsReturned * 100)}%)`)
  console.log(`Basin correct:   ${basinCorrect}/${dlsReturned} (${Math.round(basinCorrect / dlsReturned * 100)}%)`)
  console.log(`Parcel correct:  ${parcelCorrect}/${dlsReturned} (${Math.round(parcelCorrect / dlsReturned * 100)}%)`)
  console.log(`All three match: ${allCorrect}/${dlsReturned} (${Math.round(allCorrect / dlsReturned * 100)}%)`)
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1) })
