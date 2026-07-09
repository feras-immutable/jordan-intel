import axios from "axios"
import { getDb } from "./db.js"

const PROXY = "https://maps.dls.gov.jo/DotNet/proxy.ashx"
const SERVICE = "https://maps.dls.gov.jo/arcgis/rest/services/DLS/DLS_Cassini/MapServer"
const HEADERS = {
  "Referer": "https://maps.dls.gov.jo/dlsweb/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
}

// Query DLS for village+basin centroid to get approximate coordinates
async function getBasinCentroid(villCode: string, hodCode: string): Promise<{ lat: number; lng: number } | null> {
  // Layer 5 = basin boundaries, query by village and basin code
  const where = `VILL_CODE='${villCode.padStart(4, "0")}' AND HOD_CODE='${hodCode.padStart(3, "0")}'`
  const url = `${PROXY}?${SERVICE}/5/query?f=json&where=${encodeURIComponent(where)}&outFields=*&returnGeometry=true&outSR=4326`

  try {
    const r = await axios.get(url, { headers: HEADERS, timeout: 15000 })
    if (r.data.features?.length > 0) {
      const geom = r.data.features[0].geometry
      if (geom?.rings?.[0]) {
        // Calculate centroid of basin polygon
        let cx = 0, cy = 0
        const ring = geom.rings[0]
        for (const pt of ring) { cx += pt[0]; cy += pt[1] }
        cx /= ring.length; cy /= ring.length
        return { lat: cy, lng: cx }
      }
    }
  } catch { /* skip */ }
  return null
}

async function main() {
  const db = getDb()
  console.log("=== RESOLVING MOJ AUCTION COORDINATES ===\n")

  // Get MOJ auctions without coordinates
  const auctions = db.prepare(`
    SELECT sr.id as source_id, sr.source_property_id, o.id as obs_id,
      o.village, o.basin, o.latitude, o.longitude
    FROM source_records sr
    JOIN observations o ON o.source_record_id = sr.id
      AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
    WHERE sr.institution_id = 'moj_auctions' AND sr.currently_active = 1
      AND o.latitude IS NULL AND o.basin IS NOT NULL
  `).all() as any[]

  console.log(`Auctions without coordinates: ${auctions.length}\n`)

  const update = db.prepare("UPDATE observations SET latitude = ?, longitude = ? WHERE id = ?")
  let resolved = 0, failed = 0

  // Extract village and basin codes from the parsed data
  for (let i = 0; i < auctions.length; i++) {
    const a = auctions[i]

    // Basin format is "البلد (23)" — extract the number
    const basinNumMatch = a.basin?.match(/\((\d+)\)/)
    const basinNum = basinNumMatch ? basinNumMatch[1] : null

    // We need village code — check if we can find it from the raw data
    // MOJ auctions store village names, not codes. We need to look up the code.
    // Try using DLS layer 6 (villages) to find the village by name
    if (!basinNum) { failed++; continue }

    // First find village code by name
    let villCode: string | null = null
    try {
      const villageName = a.village?.trim()
      if (villageName) {
        const vUrl = `${PROXY}?${SERVICE}/6/query?f=json&where=${encodeURIComponent(`VILL_NAME_A='${villageName}' OR VILL_NAME_E='${villageName}'`)}&outFields=VILL_CODE&returnGeometry=false`
        const vr = await axios.get(vUrl, { headers: HEADERS, timeout: 10000 })
        if (vr.data.features?.length > 0) {
          villCode = vr.data.features[0].attributes.VILL_CODE
        }
      }
    } catch { /* skip */ }

    if (!villCode) {
      // Try Arabic name variations
      try {
        const vUrl = `${PROXY}?${SERVICE}/6/query?f=json&where=${encodeURIComponent(`VILL_NAME_A LIKE '%${a.village}%'`)}&outFields=VILL_CODE,VILL_NAME_A&returnGeometry=false&resultRecordCount=1`
        const vr = await axios.get(vUrl, { headers: HEADERS, timeout: 10000 })
        if (vr.data.features?.length > 0) {
          villCode = vr.data.features[0].attributes.VILL_CODE
        }
      } catch { /* skip */ }
    }

    if (!villCode) { failed++; process.stdout.write("x"); continue }

    // Now get basin centroid
    const coords = await getBasinCentroid(villCode, basinNum)
    if (coords) {
      update.run(coords.lat, coords.lng, a.obs_id)
      resolved++
      process.stdout.write(".")
    } else {
      failed++
      process.stdout.write("x")
    }

    await new Promise(r => setTimeout(r, 400))

    if ((i + 1) % 20 === 0) console.log(` ${i + 1}/${auctions.length}`)
  }

  console.log(`\n\n=== RESULTS ===`)
  console.log(`Resolved: ${resolved}/${auctions.length}`)
  console.log(`Failed: ${failed}`)
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1) })
