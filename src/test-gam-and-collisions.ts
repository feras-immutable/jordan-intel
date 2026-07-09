import axios from "axios"
import Database from "better-sqlite3"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const db = new Database(join(__dirname, "..", "jordan-intel.db"))

const ALGOLIA_APP = "LL8IZ711CS"
const ALGOLIA_KEY = "eba05366688fef592618f7defd9f3e7e"
const ALGOLIA_INDEX = "bayut-jo-production-ads-city-level-score-en"

// ─── EXPERIMENT B: GAM Amman Explorer (longer timeout) ─────────────────────────

async function testGAM() {
  console.log("=== EXPERIMENT B: GAM AMMAN EXPLORER ===\n")

  // First, try to list services with a 30s timeout
  const serviceUrl = "https://www.ammancitygis.gov.jo/ArcGis/rest/services/AMMAN_EXPLORER/MapServer"
  try {
    const r = await axios.get(serviceUrl + "?f=json", {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 30000,
    })
    console.log("MapServer responded:", r.status)
    if (r.data?.layers) {
      console.log("Layers found:", r.data.layers.length)
      for (const l of r.data.layers.slice(0, 15)) {
        console.log(`  ${l.id}: ${l.name} (${l.type || ""})`)
      }
    }
    if (r.data?.error) console.log("Error:", r.data.error.message)
  } catch (err: any) {
    console.log("MapServer failed:", err.message)
  }

  // Try identify at a known bank property location in Amman
  // Housing Bank property: 31.9516389, 35.9693695 (Al-Qweismeh area)
  const lat = 31.9516389
  const lng = 35.9693695
  console.log(`\nIdentify at ${lat}, ${lng} (Al-Qweismeh)...`)

  try {
    const identUrl = `${serviceUrl}/identify`
    const r = await axios.get(identUrl, {
      params: {
        geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
        geometryType: "esriGeometryPoint",
        sr: 4326,
        layers: "all",
        tolerance: 5,
        mapExtent: `${lng - 0.005},${lat - 0.005},${lng + 0.005},${lat + 0.005}`,
        imageDisplay: "600,400,96",
        returnGeometry: true,
        f: "json",
      },
      timeout: 30000,
    })
    if (r.data?.results?.length > 0) {
      console.log(`✓ ${r.data.results.length} results!`)
      for (const res of r.data.results) {
        console.log(`  Layer: ${res.layerName} (#${res.layerId})`)
        console.log(`  Attributes: ${JSON.stringify(res.attributes).slice(0, 400)}`)
      }
    } else {
      console.log("No results:", JSON.stringify(r.data).slice(0, 300))
    }
  } catch (err: any) {
    console.log("Identify failed:", err.message)
  }

  // Try FeatureServer
  console.log("\nTrying FeatureServer...")
  try {
    const fsUrl = "https://www.ammancitygis.gov.jo/ArcGis/rest/services/AMMAN_EXPLORER/FeatureServer"
    const r = await axios.get(fsUrl + "?f=json", { timeout: 30000 })
    console.log("FeatureServer:", r.status)
    if (r.data?.layers) {
      for (const l of r.data.layers.slice(0, 10)) {
        console.log(`  ${l.id}: ${l.name}`)
      }
    }
  } catch (err: any) {
    console.log("FeatureServer:", err.message)
  }

  // Also check AMMAN MapServer directly
  try {
    const ammanUrl = "https://www.ammancitygis.gov.jo/ArcGis/rest/services/AMMAN/MapServer"
    const r = await axios.get(ammanUrl + "?f=json", { timeout: 30000 })
    console.log("\nAMMAN MapServer:", r.status)
    if (r.data?.layers) {
      for (const l of r.data.layers.slice(0, 10)) {
        console.log(`  ${l.id}: ${l.name}`)
      }
    }
  } catch (err: any) {
    console.log("AMMAN MapServer:", err.message)
  }
}

// ─── EXPERIMENT C: Reverse spatial collisions ──────────────────────────────────

async function testCollisions() {
  console.log("\n\n=== EXPERIMENT C: REVERSE SPATIAL COLLISIONS ===\n")

  // Get all bank properties with coordinates
  const bankProps = db.prepare(`
    SELECT sr.source_property_id, sr.institution_id, o.price, o.area_sqm,
      o.latitude, o.longitude, o.title, o.village, o.basin, o.parcel_number,
      srp.asset_level, i.name_en as bank_name
    FROM source_records sr
    JOIN observations o ON o.source_record_id = sr.id
      AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
    LEFT JOIN source_record_parcels srp ON srp.source_record_id = sr.id
    JOIN institutions i ON i.id = sr.institution_id
    WHERE sr.currently_active = 1 AND o.latitude IS NOT NULL AND o.longitude IS NOT NULL
  `).all() as any[]

  console.log(`Bank properties with coordinates: ${bankProps.length}`)

  // For each bank property, search Bayut within radius using Algolia's aroundLatLng
  let totalCandidates = 0
  const candidates: any[] = []

  // Test with a subset first (50 properties)
  const toTest = bankProps.filter(p => p.asset_level === "parcel").slice(0, 30)
    .concat(bankProps.filter(p => p.asset_level === "building").slice(0, 10))
    .concat(bankProps.filter(p => p.asset_level === "unit").slice(0, 10))

  console.log(`Testing ${toTest.length} bank properties against Bayut...\n`)

  for (let i = 0; i < toTest.length; i++) {
    const bp = toTest[i]
    try {
      const r = await axios.post(
        `https://${ALGOLIA_APP}-dsn.algolia.net/1/indexes/${ALGOLIA_INDEX}/query`,
        {
          query: "أرض",
          aroundLatLng: `${bp.latitude},${bp.longitude}`,
          aroundRadius: 250, // 250 meters
          hitsPerPage: 5,
          filters: "purpose:for-sale",
        },
        {
          headers: {
            "X-Algolia-Application-Id": ALGOLIA_APP,
            "X-Algolia-API-Key": ALGOLIA_KEY,
          },
          timeout: 10000,
        }
      )

      if (r.data.nbHits > 0) {
        totalCandidates += r.data.nbHits
        for (const hit of r.data.hits) {
          // Calculate actual distance
          const dlat = (bp.latitude - hit._geoloc.lat) * 111000
          const dlng = (bp.longitude - hit._geoloc.lng) * 111000 * Math.cos(bp.latitude * Math.PI / 180)
          const dist = Math.round(Math.sqrt(dlat * dlat + dlng * dlng))

          // Area similarity
          const retailArea = hit.area || hit.plotArea || 0
          const bankArea = bp.area_sqm || 0
          const areaSim = bankArea && retailArea ? Math.round(Math.min(bankArea, retailArea) / Math.max(bankArea, retailArea) * 100) : 0

          candidates.push({
            bankRef: bp.source_property_id,
            bankName: bp.bank_name,
            bankPrice: bp.price,
            bankArea: bp.area_sqm,
            bankTitle: bp.title?.slice(0, 40),
            retailId: hit.externalID,
            retailTitle: (hit.title_l1 || hit.title || "").slice(0, 50),
            retailPrice: hit.price,
            retailArea,
            dist,
            areaSim,
          })
        }
      }
    } catch { /* skip */ }

    if ((i + 1) % 10 === 0) process.stdout.write(`  ${i + 1}/${toTest.length}...`)
    await new Promise(r => setTimeout(r, 100))
  }

  console.log(`\n\nTotal Bayut listings within 250m of bank properties: ${totalCandidates}`)
  console.log(`Unique candidate matches: ${candidates.length}`)

  if (candidates.length > 0) {
    // Sort by distance
    candidates.sort((a, b) => a.dist - b.dist)

    console.log("\n🔥 CLOSEST MATCHES:")
    for (const c of candidates.slice(0, 15)) {
      console.log(`\n  Distance: ${c.dist}m | Area similarity: ${c.areaSim}%`)
      console.log(`  BANK: ${c.bankName} ${c.bankRef}`)
      console.log(`    ${c.bankTitle} — ${c.bankPrice} JOD — ${c.bankArea} m²`)
      console.log(`  BAYUT: ${c.retailId}`)
      console.log(`    ${c.retailTitle} — ${c.retailPrice} JOD — ${c.retailArea} m²`)
      if (c.bankPrice && c.retailPrice && c.bankPrice !== c.retailPrice) {
        const diff = Math.round(Math.abs(c.bankPrice - c.retailPrice) / Math.max(c.bankPrice, c.retailPrice) * 100)
        console.log(`  💰 PRICE DIFFERENCE: ${diff}% (${c.bankPrice < c.retailPrice ? "bank cheaper" : "retail cheaper"})`)
      }
    }

    // Summary
    const withPriceDiff = candidates.filter(c => c.bankPrice && c.retailPrice && c.bankPrice !== c.retailPrice)
    const bankCheaper = withPriceDiff.filter(c => c.bankPrice < c.retailPrice)
    console.log("\n\n=== COLLISION SUMMARY ===")
    console.log(`Candidates within 250m: ${candidates.length}`)
    console.log(`With price data on both sides: ${withPriceDiff.length}`)
    console.log(`Bank cheaper: ${bankCheaper.length}`)
    console.log(`Retail cheaper: ${withPriceDiff.length - bankCheaper.length}`)
  }
}

async function main() {
  await testGAM()
  await testCollisions()
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1) })
