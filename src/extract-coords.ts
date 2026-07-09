import Database from "better-sqlite3"
import axios from "axios"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const DB_PATH = join(__dirname, "..", "jordan-intel.db")

const db = new Database(DB_PATH)

// Parse DMS (degrees, minutes, seconds) from URL-encoded Google Maps query
// Format: 32°02'04.3"N+35°49'32.2"E (URL-encoded)
function parseDmsFromUrl(url: string): { lat: number; lng: number } | null {
  // Decode URL
  const decoded = decodeURIComponent(url)
  // Match DMS pattern: 32°02'04.3"N 35°49'32.2"E
  const dmsMatch = decoded.match(/(\d+)°(\d+)'([\d.]+)"([NS])\s*\+?\s*(\d+)°(\d+)'([\d.]+)"([EW])/)
  if (!dmsMatch) return null

  const latDeg = parseInt(dmsMatch[1])
  const latMin = parseInt(dmsMatch[2])
  const latSec = parseFloat(dmsMatch[3])
  const latDir = dmsMatch[4]
  const lngDeg = parseInt(dmsMatch[5])
  const lngMin = parseInt(dmsMatch[6])
  const lngSec = parseFloat(dmsMatch[7])
  const lngDir = dmsMatch[8]

  let lat = latDeg + latMin / 60 + latSec / 3600
  let lng = lngDeg + lngMin / 60 + lngSec / 3600
  if (latDir === "S") lat = -lat
  if (lngDir === "W") lng = -lng

  return { lat: Math.round(lat * 1000000) / 1000000, lng: Math.round(lng * 1000000) / 1000000 }
}

// Extract coords from standard Google Maps URL patterns
function parseDirectCoords(url: string): { lat: number; lng: number } | null {
  const decoded = decodeURIComponent(url)
  // @lat,lng pattern
  const atMatch = decoded.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
  if (atMatch) return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) }
  // q=lat,lng pattern
  const qMatch = decoded.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/)
  if (qMatch) return { lat: parseFloat(qMatch[1]), lng: parseFloat(qMatch[2]) }
  // center=lat,lng
  const cMatch = decoded.match(/center=(-?\d+\.\d+),(-?\d+\.\d+)/)
  if (cMatch) return { lat: parseFloat(cMatch[1]), lng: parseFloat(cMatch[2]) }
  return null
}

// Resolve a shortened URL by following redirects
async function resolveShortUrl(url: string): Promise<string | null> {
  try {
    const resp = await axios.head(url, {
      maxRedirects: 5,
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    return resp.request?.res?.responseUrl || resp.config?.url || null
  } catch (err: any) {
    // axios may throw on redirect but still have the final URL
    if (err.response?.headers?.location) return err.response.headers.location
    if (err.request?.res?.responseUrl) return err.request.res.responseUrl
    return null
  }
}

async function main() {
  // Get all records with map URLs but no coordinates
  const records = db.prepare(`
    SELECT sr.id, sr.source_property_id, sr.institution_id, sr.raw_data
    FROM source_records sr
    WHERE sr.currently_active = 1
  `).all() as Array<{ id: number; source_property_id: string; institution_id: string; raw_data: string }>

  const updateObs = db.prepare(`
    UPDATE observations SET latitude = ?, longitude = ?
    WHERE source_record_id = ? AND id = (SELECT MAX(id) FROM observations WHERE source_record_id = ?)
  `)

  let resolved = 0
  let dmsResolved = 0
  let redirectResolved = 0
  let failed = 0
  let noUrl = 0
  let alreadyHas = 0
  let processed = 0

  for (const r of records) {
    processed++
    const raw = JSON.parse(r.raw_data)
    const mapUrl: string = raw.locationLink || raw.raw_map_url || ""

    if (!mapUrl) { noUrl++; continue }

    // Check if we already have coords
    const obs = db.prepare(`
      SELECT latitude, longitude FROM observations
      WHERE source_record_id = ? ORDER BY id DESC LIMIT 1
    `).get(r.id) as { latitude: number | null; longitude: number | null } | undefined

    if (obs?.latitude && obs?.longitude) { alreadyHas++; continue }

    // Try DMS parsing first (no network needed)
    const dmsCoords = parseDmsFromUrl(mapUrl)
    if (dmsCoords) {
      updateObs.run(dmsCoords.lat, dmsCoords.lng, r.id, r.id)
      dmsResolved++
      resolved++
      continue
    }

    // Try direct coord parsing
    const directCoords = parseDirectCoords(mapUrl)
    if (directCoords) {
      updateObs.run(directCoords.lat, directCoords.lng, r.id, r.id)
      resolved++
      continue
    }

    // Short URL — need to resolve redirect
    if (mapUrl.includes("goo.gl") || mapUrl.includes("maps.app")) {
      const resolvedUrl = await resolveShortUrl(mapUrl)
      if (resolvedUrl) {
        const coords = parseDirectCoords(resolvedUrl) || parseDmsFromUrl(resolvedUrl)
        if (coords) {
          updateObs.run(coords.lat, coords.lng, r.id, r.id)
          redirectResolved++
          resolved++
          continue
        }
      }
      failed++
      // Rate limit
      await new Promise(r => setTimeout(r, 200))
    }

    if (processed % 50 === 0) console.log(`Processing ${processed}/${records.length}...`)
  }

  console.log("\n=== COORDINATE EXTRACTION ===")
  console.log(`Total records: ${records.length}`)
  console.log(`Already had coords: ${alreadyHas}`)
  console.log(`No map URL: ${noUrl}`)
  console.log(`Resolved: ${resolved}`)
  console.log(`  - DMS decoded: ${dmsResolved}`)
  console.log(`  - Redirect resolved: ${redirectResolved}`)
  console.log(`  - Direct parse: ${resolved - dmsResolved - redirectResolved}`)
  console.log(`Failed: ${failed}`)
  console.log(`\nCoordinate coverage: ${resolved}/${records.length} (${Math.round(resolved / records.length * 100)}%)`)
}

main().catch(err => {
  console.error("Fatal:", err)
  process.exit(1)
})
