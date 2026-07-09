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

// Get ALL parcels within a radius using an envelope query on layer 2 (parcels)
async function getCandidateParcels(lat: number, lng: number, radiusMeters: number) {
  const { x, y } = toWebMercator(lng, lat)
  const geom = JSON.stringify({
    xmin: x - radiusMeters, ymin: y - radiusMeters,
    xmax: x + radiusMeters, ymax: y + radiusMeters,
    spatialReference: { wkid: 102100 },
  })
  const url = `${PROXY}?${SERVICE}/2/query?f=json&geometry=${encodeURIComponent(geom)}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&inSR=102100`

  const r = await axios.get(url, { headers: HEADERS, timeout: 20000 })
  return (r.data.features || []).map((f: any) => {
    const a = f.attributes
    return {
      objectId: a.OBJECTID,
      villCode: parseInt(a.VILL_CODE || "0"),
      hodCode: parseInt(a.HOD_CODE || "0"),
      parcelId: parseInt(a.PARCEL_ID || "0"),
      dlsKey: a.DLS_KEY || "",
      area: a["SHAPE.AREA"] || 0,
      // Calculate centroid distance from pin (rough — using envelope center if no geometry)
      geometry: f.geometry,
    }
  }).filter((p: any) => p.villCode > 0) // Filter out null/empty parcels
}

// Calculate distance from point to polygon centroid (rough)
function distanceToParcel(pinX: number, pinY: number, parcel: any): number {
  if (!parcel.geometry?.rings?.[0]) return 99999
  const ring = parcel.geometry.rings[0]
  let cx = 0, cy = 0
  for (const pt of ring) {
    cx += pt[0]
    cy += pt[1]
  }
  cx /= ring.length
  cy /= ring.length
  return Math.sqrt((pinX - cx) ** 2 + (pinY - cy) ** 2)
}

async function main() {
  console.log("=== CANDIDATE PARCEL RESOLVER TEST ===\n")
  console.log("For each bank property with a known parcel, find nearby DLS parcels")
  console.log("and check if the TRUE parcel appears in Top-1, Top-3, Top-5 candidates.\n")

  const controls = db.prepare(`
    SELECT sr.source_property_id,
      o.latitude, o.longitude, o.area_sqm, o.village, o.basin,
      p.village_id as known_vill, p.basin_id as known_basin, p.parcel_number as known_parcel
    FROM source_records sr
    JOIN observations o ON o.source_record_id = sr.id
      AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
    JOIN source_record_parcels srp ON srp.source_record_id = sr.id
    JOIN parcels p ON p.id = srp.parcel_id
    WHERE sr.currently_active = 1
      AND o.latitude IS NOT NULL AND p.village_id IS NOT NULL
      AND p.basin_id IS NOT NULL AND p.parcel_number IS NOT NULL
    ORDER BY RANDOM() LIMIT 25
  `).all() as any[]

  console.log(`Testing ${controls.length} known bank properties\n`)

  let top1 = 0, top3 = 0, top5 = 0, found = 0, notFound = 0
  const distances: number[] = []

  for (let i = 0; i < controls.length; i++) {
    const c = controls[i]
    const { x: pinX, y: pinY } = toWebMercator(c.longitude, c.latitude)

    process.stdout.write(`${i + 1}/${controls.length} ${c.source_property_id}: `)

    try {
      const candidates = await getCandidateParcels(c.latitude, c.longitude, 500)

      if (candidates.length === 0) {
        console.log("No candidates found")
        notFound++
        continue
      }

      // Score each candidate
      const scored = candidates.map((cand: any) => {
        let score = 0
        const dist = distanceToParcel(pinX, pinY, cand)

        // Village match
        if (cand.villCode === c.known_vill) score += 30
        // Basin match
        if (cand.hodCode === c.known_basin) score += 25
        // Area similarity (if we know the listing area)
        if (c.area_sqm && cand.area > 0) {
          const ratio = Math.min(c.area_sqm, cand.area) / Math.max(c.area_sqm, cand.area)
          score += ratio * 20 // Up to 20 points for exact area match
        }
        // Distance (closer = better, max 25 points)
        score += Math.max(0, 25 - dist / 20)

        return { ...cand, score, dist: Math.round(dist) }
      })

      // Sort by score descending
      scored.sort((a: any, b: any) => b.score - a.score)

      // Check if true parcel is in top N
      const trueIdx = scored.findIndex((s: any) =>
        s.villCode === c.known_vill && s.hodCode === c.known_basin && s.parcelId === c.known_parcel
      )

      if (trueIdx >= 0) {
        found++
        if (trueIdx === 0) top1++
        if (trueIdx < 3) top3++
        if (trueIdx < 5) top5++
        distances.push(scored[trueIdx].dist)
        console.log(`✓ TRUE parcel at rank #${trueIdx + 1} (dist: ${scored[trueIdx].dist}m, score: ${scored[trueIdx].score.toFixed(0)}) out of ${scored.length} candidates`)
      } else {
        notFound++
        // Check if true parcel was even in the 500m radius
        const trueInAll = candidates.find((c2: any) =>
          c2.villCode === c.known_vill && c2.hodCode === c.known_basin && c2.parcelId === c.known_parcel
        )
        if (trueInAll) {
          console.log(`✗ TRUE parcel in candidates but not scored (shouldn't happen)`)
        } else {
          console.log(`✗ TRUE parcel NOT within 500m radius (${scored.length} candidates found)`)
        }
      }
    } catch (err: any) {
      notFound++
      console.log(`ERROR: ${err.message}`)
    }

    await new Promise(r => setTimeout(r, 600))
  }

  console.log("\n\n=== RESULTS ===")
  console.log(`Tested: ${controls.length}`)
  console.log(`True parcel found in candidates: ${found}/${controls.length} (${Math.round(found / controls.length * 100)}%)`)
  console.log(`True parcel NOT in 500m radius: ${notFound}`)
  console.log()
  console.log(`Top-1 (auto-resolve): ${top1}/${controls.length} (${Math.round(top1 / controls.length * 100)}%)`)
  console.log(`Top-3 (easy review):  ${top3}/${controls.length} (${Math.round(top3 / controls.length * 100)}%)`)
  console.log(`Top-5 (review queue): ${top5}/${controls.length} (${Math.round(top5 / controls.length * 100)}%)`)

  if (distances.length > 0) {
    distances.sort((a, b) => a - b)
    console.log(`\nDistance to true parcel:`)
    console.log(`  Min: ${distances[0]}m`)
    console.log(`  Median: ${distances[Math.floor(distances.length / 2)]}m`)
    console.log(`  Max: ${distances[distances.length - 1]}m`)
    console.log(`  Within 100m: ${distances.filter(d => d <= 100).length}/${distances.length}`)
    console.log(`  Within 250m: ${distances.filter(d => d <= 250).length}/${distances.length}`)
    console.log(`  Within 500m: ${distances.filter(d => d <= 500).length}/${distances.length}`)
  }
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1) })
