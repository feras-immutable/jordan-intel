import axios from "axios"

async function main() {
  const resp = await axios.get("https://www.bayut.jo/en/property/details-UID000505.html", {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    timeout: 15000,
  })
  const html = resp.data

  // Extract JSON-LD
  const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
  if (jsonLdMatch) {
    const ld = JSON.parse(jsonLdMatch[1])
    const listing = ld["@graph"]?.find((x: any) => x["@type"] === "RealEstateListing")
    console.log("=== JSON-LD LISTING ===")
    console.log(JSON.stringify(listing, null, 2).slice(0, 2000))
  }

  // Extract Algolia config
  const algoliaMatch = html.match(/"algolia":\{"appId":"([^"]+)","apiKey":"([^"]+)"/)
  if (algoliaMatch) {
    console.log("\n=== ALGOLIA CONFIG ===")
    console.log("App ID:", algoliaMatch[1])
    console.log("API Key:", algoliaMatch[2])
  }

  // Try to find the property data in window.state
  const stateStart = html.indexOf("window.state = {")
  if (stateStart > -1) {
    const chunk = html.slice(stateStart, stateStart + 2000)
    // Find property-relevant keys
    const keyMatches = chunk.match(/"(?:property|listing|details|area|price|basin|village|location)[^"]*"/gi) || []
    console.log("\n=== WINDOW.STATE KEYS ===")
    console.log([...new Set(keyMatches)].slice(0, 20))
  }

  // Try Algolia search directly for Amman land listings
  if (algoliaMatch) {
    const appId = algoliaMatch[1]
    const apiKey = algoliaMatch[2]
    console.log("\n=== TESTING ALGOLIA SEARCH ===")

    // Find the index name
    const indexMatch = html.match(/"indexName":\s*"([^"]+)"/)
    console.log("Index name:", indexMatch?.[1])

    try {
      const searchResp = await axios.post(
        `https://${appId}-dsn.algolia.net/1/indexes/${indexMatch?.[1] || "bayut-jo-en-production"}/query`,
        {
          query: "",
          filters: "category:residential-lands AND city:amman",
          hitsPerPage: 3,
        },
        {
          headers: {
            "X-Algolia-Application-Id": appId,
            "X-Algolia-API-Key": apiKey,
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      )
      console.log("Algolia hits:", searchResp.data.nbHits)
      if (searchResp.data.hits?.[0]) {
        console.log("\nFirst hit keys:", Object.keys(searchResp.data.hits[0]))
        console.log("\nFirst hit:", JSON.stringify(searchResp.data.hits[0]).slice(0, 1500))
      }
    } catch (err: any) {
      console.log("Algolia search failed:", err.response?.status, err.response?.data?.message || err.message)
      // Try different index names
      for (const idx of ["bayut-jo-production", "bayut-jo-en", "production_properties_jo"]) {
        try {
          const r = await axios.post(
            `https://${appId}-dsn.algolia.net/1/indexes/${idx}/query`,
            { query: "land amman", hitsPerPage: 1 },
            {
              headers: {
                "X-Algolia-Application-Id": appId,
                "X-Algolia-API-Key": apiKey,
              },
              timeout: 5000,
            }
          )
          console.log(`Index "${idx}": ${r.data.nbHits} hits`)
          if (r.data.hits?.[0]) {
            console.log("  Keys:", Object.keys(r.data.hits[0]).join(", "))
            break
          }
        } catch { /* skip */ }
      }
    }
  }
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1) })
