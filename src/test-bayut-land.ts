import axios from "axios"

const APP_ID = "LL8IZ711CS"
const API_KEY = "eba05366688fef592618f7defd9f3e7e"
const INDEX = "bayut-jo-production-ads-city-level-score-en"

async function search(params: Record<string, any>) {
  const resp = await axios.post(
    `https://${APP_ID}-dsn.algolia.net/1/indexes/${INDEX}/query`,
    params,
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
  // Find land category structure — the category field is nested
  // Let's search for "land" and check what category values look like
  const r = await search({ query: "أرض للبيع عمان", hitsPerPage: 5, filters: "purpose:for-sale" })
  console.log("Arabic land search:", r.nbHits, "hits\n")

  for (const hit of r.hits) {
    const cats = hit.category?.map((c: any) => c.slug).join(" > ")
    const loc = hit.location?.map((l: any) => l.name).join(" > ")
    console.log(`${hit.externalID}: ${hit.title}`)
    console.log(`  Category: ${cats}`)
    console.log(`  Location: ${loc}`)
    console.log(`  Price: ${hit.price} JOD | Area: ${hit.area} sqft | PlotArea: ${hit.plotArea}`)
    console.log(`  Coords: ${hit._geoloc?.lat}, ${hit._geoloc?.lng}`)

    // Check for basin/parcel info in title or description
    const title = hit.title_l1 || hit.title || ""
    const basinMatch = title.match(/حوض\s*([^\s,،]+(?:\s*\d+)?)/i)
    const parcelMatch = title.match(/قطعة\s*(?:رقم\s*)?\(?\s*(\d+)\s*\)?/i)
    if (basinMatch) console.log(`  BASIN FOUND: ${basinMatch[1]}`)
    if (parcelMatch) console.log(`  PARCEL FOUND: ${parcelMatch[1]}`)
    console.log()
  }

  // Now try to filter by land category
  // The category slug is "residential" > "residential-lands" or similar
  // Try faceted search to discover category values
  const facets = await search({
    query: "",
    hitsPerPage: 0,
    facets: ["category.level_1.slug", "category.level_0.slug"],
    filters: "purpose:for-sale"
  })
  console.log("=== CATEGORY FACETS ===")
  console.log("Level 0:", JSON.stringify(facets.facets?.["category.level_0.slug"]))
  console.log("Level 1:", JSON.stringify(facets.facets?.["category.level_1.slug"]))

  // Now search with proper category filter for land
  for (const filter of [
    'purpose:for-sale AND category.level_1.slug:residential-lands',
    'purpose:for-sale AND category.level_1.slug:lands',
    'purpose:for-sale AND category.level_1.externalID:14',
  ]) {
    try {
      const r = await search({ query: "", filters: filter, hitsPerPage: 1 })
      console.log(`\nFilter "${filter}": ${r.nbHits} hits`)
      if (r.hits?.[0]) {
        console.log(`  Sample: ${r.hits[0].title} - ${r.hits[0].price} JOD`)
      }
    } catch (err: any) {
      console.log(`Filter "${filter}": ERROR - ${err.response?.data?.message || err.message}`)
    }
  }

  // Location filter for Amman
  const ammanLand = await search({
    query: "",
    filters: 'purpose:for-sale AND category.level_1.slug:residential-lands AND location.level_1.slug:/amman',
    hitsPerPage: 3,
  })
  console.log(`\n=== AMMAN RESIDENTIAL LAND ===`)
  console.log(`Total: ${ammanLand.nbHits}`)
  for (const hit of ammanLand.hits || []) {
    console.log(`  ${hit.externalID}: ${hit.title_l1?.slice(0, 60)} | ${hit.price} JOD | ${hit.area} sqft`)
  }
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1) })
