import axios from "axios"
import Database from "better-sqlite3"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const db = new Database(join(__dirname, "..", "jordan-intel.db"))

const ALGOLIA_APP = "LL8IZ711CS"
const ALGOLIA_KEY = "eba05366688fef592618f7defd9f3e7e"
const ALGOLIA_INDEX = "bayut-jo-production-ads-city-level-score-en"

async function main() {
  console.log("=== REVERSE COLLISION v2: No text filter ===\n")

  const bankProps = db.prepare(`
    SELECT sr.source_property_id, sr.institution_id, o.price, o.area_sqm,
      o.latitude, o.longitude, o.title, srp.asset_level, i.name_en as bank_name
    FROM source_records sr
    JOIN observations o ON o.source_record_id = sr.id
      AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
    LEFT JOIN source_record_parcels srp ON srp.source_record_id = sr.id
    JOIN institutions i ON i.id = sr.institution_id
    WHERE sr.currently_active = 1 AND o.latitude IS NOT NULL
  `).all() as any[]

  console.log(`Bank properties with coords: ${bankProps.length}`)

  // Test ALL bank properties with NO text query — just geo radius
  let totalHits = 0
  const candidates: any[] = []

  for (let i = 0; i < bankProps.length; i++) {
    const bp = bankProps[i]
    try {
      const r = await axios.post(
        `https://${ALGOLIA_APP}-dsn.algolia.net/1/indexes/${ALGOLIA_INDEX}/query`,
        {
          query: "",  // No text filter — any property type
          aroundLatLng: `${bp.latitude},${bp.longitude}`,
          aroundRadius: 200,
          hitsPerPage: 3,
          filters: "purpose:for-sale",
        },
        {
          headers: {
            "X-Algolia-Application-Id": ALGOLIA_APP,
            "X-Algolia-API-Key": ALGOLIA_KEY,
          },
          timeout: 8000,
        }
      )

      if (r.data.nbHits > 0) {
        totalHits += r.data.nbHits
        for (const hit of r.data.hits) {
          const dlat = (bp.latitude - hit._geoloc.lat) * 111000
          const dlng = (bp.longitude - hit._geoloc.lng) * 111000 * Math.cos(bp.latitude * Math.PI / 180)
          const dist = Math.round(Math.sqrt(dlat * dlat + dlng * dlng))

          candidates.push({
            bankRef: bp.source_property_id,
            bankName: bp.bank_name,
            bankPrice: bp.price,
            bankArea: bp.area_sqm,
            bankTitle: (bp.title || "").slice(0, 40),
            bankLevel: bp.asset_level,
            retailId: hit.externalID,
            retailTitle: (hit.title_l1 || hit.title || "").slice(0, 50),
            retailPrice: hit.price,
            retailArea: hit.area,
            retailCategory: hit.category?.map((c: any) => c.slug).join(">") || "",
            dist,
          })
        }
      }
    } catch { /* skip */ }

    if ((i + 1) % 50 === 0) process.stdout.write(`${i + 1}/${bankProps.length}...`)
    await new Promise(r => setTimeout(r, 80))
  }

  console.log(`\n\nTotal Bayut listings within 200m of bank properties: ${totalHits}`)
  console.log(`Candidate pairs: ${candidates.length}`)

  if (candidates.length > 0) {
    candidates.sort((a, b) => a.dist - b.dist)

    console.log("\n🔥 CLOSEST MATCHES:")
    for (const c of candidates.slice(0, 20)) {
      console.log(`\n  ${c.dist}m away | Category: ${c.retailCategory}`)
      console.log(`  BANK: ${c.bankName} ${c.bankRef} [${c.bankLevel}]`)
      console.log(`    ${c.bankTitle} — ${c.bankPrice} JOD — ${c.bankArea || "?"} m²`)
      console.log(`  BAYUT: ${c.retailId}`)
      console.log(`    ${c.retailTitle} — ${c.retailPrice} JOD — ${c.retailArea || "?"} m²`)
      if (c.bankPrice && c.retailPrice) {
        const diff = Math.round(Math.abs(c.bankPrice - c.retailPrice) / Math.max(c.bankPrice, c.retailPrice) * 100)
        console.log(`  💰 PRICE GAP: ${diff}% (${c.bankPrice < c.retailPrice ? "bank cheaper" : "retail cheaper"})`)
      }
    }

    // Stats
    const landPairs = candidates.filter(c => c.retailCategory.includes("land") || c.bankLevel === "parcel")
    const withPrices = candidates.filter(c => c.bankPrice && c.retailPrice)
    const bankCheaper = withPrices.filter(c => c.bankPrice < c.retailPrice)
    console.log("\n=== SUMMARY ===")
    console.log(`All candidates: ${candidates.length}`)
    console.log(`Land-related: ${landPairs.length}`)
    console.log(`Both have prices: ${withPrices.length}`)
    console.log(`Bank cheaper: ${bankCheaper.length}`)
    console.log(`Retail cheaper: ${withPrices.length - bankCheaper.length}`)
  } else {
    // Debug: check if Bayut has ANY listings in the areas where banks are
    console.log("\n--- DEBUGGING: checking if Bayut has listings in bank areas ---")
    const sampleCoords = bankProps.slice(0, 5)
    for (const bp of sampleCoords) {
      try {
        const r = await axios.post(
          `https://${ALGOLIA_APP}-dsn.algolia.net/1/indexes/${ALGOLIA_INDEX}/query`,
          {
            query: "",
            aroundLatLng: `${bp.latitude},${bp.longitude}`,
            aroundRadius: 2000, // 2km
            hitsPerPage: 1,
          },
          {
            headers: {
              "X-Algolia-Application-Id": ALGOLIA_APP,
              "X-Algolia-API-Key": ALGOLIA_KEY,
            },
            timeout: 8000,
          }
        )
        console.log(`  ${bp.source_property_id} (${bp.latitude},${bp.longitude}): ${r.data.nbHits} within 2km`)
      } catch { /* skip */ }
    }
  }
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1) })
