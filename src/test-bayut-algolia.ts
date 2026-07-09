import axios from "axios"

const APP_ID = "LL8IZ711CS"
const API_KEY = "eba05366688fef592618f7defd9f3e7e"
const INDEX = "bayut-jo-production-ads-city-level-score-en"

async function search(query: string, filters: string, hitsPerPage = 3) {
  const resp = await axios.post(
    `https://${APP_ID}-dsn.algolia.net/1/indexes/${INDEX}/query`,
    { query, filters, hitsPerPage },
    {
      headers: {
        "X-Algolia-Application-Id": APP_ID,
        "X-Algolia-API-Key": API_KEY,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    }
  )
  return resp.data
}

async function main() {
  // First: empty search to understand the data
  console.log("=== TESTING ALGOLIA QUERIES ===\n")

  // Try empty query with no filters
  try {
    const r1 = await search("", "", 2)
    console.log("Empty query:", r1.nbHits, "hits")
    if (r1.hits?.[0]) {
      console.log("Keys:", Object.keys(r1.hits[0]).join(", "))
      console.log("\nFirst hit sample:", JSON.stringify(r1.hits[0]).slice(0, 1000))
    }
  } catch (err: any) {
    console.log("Empty query failed:", err.response?.data?.message || err.message)
  }

  // Try with text query
  try {
    const r2 = await search("land amman", "", 2)
    console.log("\n'land amman':", r2.nbHits, "hits")
  } catch (err: any) {
    console.log("Text query failed:", err.response?.data?.message || err.message)
  }

  // Try Arabic
  try {
    const r3 = await search("أراضي عمان", "", 2)
    console.log("'أراضي عمان':", r3.nbHits, "hits")
  } catch (err: any) {
    console.log("Arabic query failed:", err.response?.data?.message || err.message)
  }

  // Try various filters
  for (const filter of [
    "purpose:for-sale",
    'purpose:"for-sale"',
    "category:land",
    "category:residential-lands",
    "type:land",
    "propertyType:land",
    "completionStatus:completed",
  ]) {
    try {
      const r = await search("", filter, 1)
      console.log(`Filter "${filter}":`, r.nbHits, "hits")
    } catch (err: any) {
      console.log(`Filter "${filter}": ERROR -`, err.response?.data?.message || err.message)
    }
  }

  // If we got hits, show full first result
  console.log("\n=== FULL FIRST RESULT ===")
  try {
    const r = await search("", "", 1)
    if (r.hits?.[0]) {
      const hit = r.hits[0]
      console.log(JSON.stringify(hit, null, 2).slice(0, 3000))
    }
  } catch (err: any) {
    console.log("Failed:", err.message)
  }
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1) })
