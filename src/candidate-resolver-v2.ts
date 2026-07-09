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

// Haversine distance in meters
function distMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Point-in-polygon (ray casting)
function pointInPolygon(px: number, py: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside
    }
  }
  return inside
}

async function getCandidatesWGS84(lat: number, lng: number, radiusMeters: number) {
  const { x, y } = toWebMercator(lng, lat)
  const geom = JSON.stringify({
    xmin: x - radiusMeters, ymin: y - radiusMeters,
    xmax: x + radiusMeters, ymax: y + radiusMeters,
    spatialReference: { wkid: 102100 },
  })
  // Request geometry in WGS84 (outSR=4326) so we can do proper distance/containment
  const url = `${PROXY}?${SERVICE}/2/query?f=json&geometry=${encodeURIComponent(geom)}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&inSR=102100&outSR=4326`

  const r = await axios.get(url, { headers: HEADERS, timeout: 20000 })
  return (r.data.features || []).map((f: any) => {
    const a = f.attributes
    return {
      villCode: parseInt(a.VILL_CODE || "0"),
      hodCode: parseInt(a.HOD_CODE || "0"),
      parcelId: parseInt(a.PARCEL_ID || "0"),
      dlsKey: a.DLS_KEY || "",
      area: a["SHAPE.AREA"] || 0,
      rings: f.geometry?.rings || [],
    }
  }).filter((p: any) => p.villCode > 0)
}

function centroid(rings: number[][][]): [number, number] {
  if (!rings[0]?.length) return [0, 0]
  let cx = 0, cy = 0
  for (const pt of rings[0]) { cx += pt[0]; cy += pt[1] }
  return [cx / rings[0].length, cy / rings[0].length]
}

async function main() {
  console.log("=== CANDIDATE RESOLVER v2 — WGS84 geometry ===\n")

  const controls = db.prepare(`
    SELECT sr.source_property_id,
      o.latitude, o.longitude, o.area_sqm,
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

  console.log(`Testing ${controls.length} controls\n`)

  let top1 = 0, top3 = 0, top5 = 0, found = 0, notFound = 0, errors = 0
  const trueDistances: number[] = []
  const containedCount: { yes: number; no: number } = { yes: 0, no: 0 }

  for (let i = 0; i < controls.length; i++) {
    const c = controls[i]
    process.stdout.write(`${i + 1}/${controls.length} ${c.source_property_id}: `)

    try {
      const candidates = await getCandidatesWGS84(c.latitude, c.longitude, 500)

      if (candidates.length === 0) {
        console.log("No candidates")
        notFound++
        continue
      }

      // Score each candidate
      const scored = candidates.map((cand: any) => {
        let score = 0
        const [cx, cy] = centroid(cand.rings)
        const dist = cx && cy ? distMeters(c.latitude, c.longitude, cy, cx) : 99999
        const contained = cand.rings[0]?.length > 0 ? pointInPolygon(c.longitude, c.latitude, cand.rings[0]) : false

        // Point-in-polygon is strongest signal
        if (contained) score += 40
        // Village match
        if (cand.villCode === c.known_vill) score += 25
        // Basin match
        if (cand.hodCode === c.known_basin) score += 20
        // Area similarity
        if (c.area_sqm && cand.area > 0) {
          const ratio = Math.min(c.area_sqm, cand.area) / Math.max(c.area_sqm, cand.area)
          score += ratio * 15
        }
        // Distance penalty (closer = better)
        if (dist < 500) score += Math.max(0, 10 * (1 - dist / 500))

        return { ...cand, score, dist: Math.round(dist), contained }
      })

      scored.sort((a: any, b: any) => b.score - a.score)

      const trueIdx = scored.findIndex((s: any) =>
        s.villCode === c.known_vill && s.hodCode === c.known_basin && s.parcelId === c.known_parcel
      )

      if (trueIdx >= 0) {
        found++
        if (trueIdx === 0) top1++
        if (trueIdx < 3) top3++
        if (trueIdx < 5) top5++
        const tp = scored[trueIdx]
        trueDistances.push(tp.dist)
        if (tp.contained) containedCount.yes++; else containedCount.no++
        console.log(`✓ Rank #${trueIdx + 1}/${scored.length} | dist: ${tp.dist}m | contained: ${tp.contained} | score: ${tp.score.toFixed(0)}`)
      } else {
        notFound++
        console.log(`✗ NOT FOUND in ${scored.length} candidates`)
      }
    } catch (err: any) {
      errors++
      console.log(`ERROR: ${err.message}`)
    }

    await new Promise(r => setTimeout(r, 700))
  }

  console.log("\n\n=== RESULTS ===")
  console.log(`Tested: ${controls.length}`)
  console.log(`Found in candidates: ${found}/${controls.length} (${Math.round(found / controls.length * 100)}%)`)
  console.log(`Not found / errors: ${notFound + errors}`)
  console.log()
  console.log(`Top-1: ${top1}/${controls.length} (${Math.round(top1 / controls.length * 100)}%)`)
  console.log(`Top-3: ${top3}/${controls.length} (${Math.round(top3 / controls.length * 100)}%)`)
  console.log(`Top-5: ${top5}/${controls.length} (${Math.round(top5 / controls.length * 100)}%)`)
  console.log()
  console.log(`Pin inside true parcel: ${containedCount.yes}/${found}`)
  console.log(`Pin outside true parcel: ${containedCount.no}/${found}`)

  if (trueDistances.length > 0) {
    trueDistances.sort((a, b) => a - b)
    console.log(`\nDistance pin → true parcel centroid:`)
    console.log(`  Min: ${trueDistances[0]}m`)
    console.log(`  Median: ${trueDistances[Math.floor(trueDistances.length / 2)]}m`)
    console.log(`  Max: ${trueDistances[trueDistances.length - 1]}m`)
  }
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1) })
