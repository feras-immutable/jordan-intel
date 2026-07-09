import axios from "axios"
import * as cheerio from "cheerio"

async function main() {
  const resp = await axios.get("https://jo.opensooq.com/ar/real-estate-for-sale/lands-for-sale", {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    timeout: 15000,
  })
  const $ = cheerio.load(resp.data)

  // Show ALL JSON-LD blocks
  $('script[type="application/ld+json"]').each((i, el) => {
    const text = $(el).html() || ""
    console.log(`JSON-LD #${i}: ${text.slice(0, 300)}`)
    console.log()
  })

  // Check for listing data in inline scripts
  const body = resp.data
  // Look for window.__ patterns
  const windowVars = body.match(/window\.\w+\s*=\s*[{[]/g) || []
  console.log("Window vars:", windowVars.slice(0, 5))

  // Look for any JSON array that looks like listings
  const listingArrays = body.match(/"itemListElement"\s*:\s*\[/g) || []
  console.log("itemListElement arrays:", listingArrays.length)

  // Check for individual post URLs in any script content
  const postUrls = body.match(/https?:\/\/jo\.opensooq\.com\/[^"'\s]*\/post\/\d+/g) || []
  console.log("\nPost URLs found:", postUrls.length)
  for (const u of [...new Set(postUrls)].slice(0, 10)) {
    console.log("  " + u)
  }

  // Also look for post IDs
  const postIds = body.match(/postId['":\s]+(\d+)/g) || []
  console.log("\nPost IDs:", postIds.slice(0, 5))

  // If we found post URLs, test one
  const uniquePostUrls = [...new Set(postUrls)]
  if (uniquePostUrls.length > 0) {
    console.log("\n=== TESTING FIRST POST ===")
    const postUrl = uniquePostUrls[0]
    try {
      const postResp = await axios.get(postUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        timeout: 10000,
      })
      const $p = cheerio.load(postResp.data)

      // Get all JSON-LD from post
      $p('script[type="application/ld+json"]').each((i, el) => {
        const txt = $p(el).html() || ""
        try {
          const ld = JSON.parse(txt)
          console.log(`Post JSON-LD #${i}:`, JSON.stringify(ld).slice(0, 500))
        } catch { /* skip */ }
      })

      // Get description from body text
      const bodyText = $p("body").text()
      const descSection = bodyText.match(/الوصف|وصف|description|details/i)
      if (descSection) {
        const idx = bodyText.indexOf(descSection[0])
        console.log("\nDescription area:", bodyText.slice(idx, idx + 300).replace(/\s+/g, " "))
      }

      // Look for basin/parcel in full page text
      const basinMatch = bodyText.match(/حوض[^,،\n]{0,30}/gi) || []
      const parcelMatch = bodyText.match(/قطع[ةه][^,،\n]{0,30}/gi) || []
      console.log("\nBasin mentions:", basinMatch.slice(0, 3))
      console.log("Parcel mentions:", parcelMatch.slice(0, 3))
    } catch (err: any) {
      console.log("Post fetch failed:", err.message)
    }
  }
}

main().catch(err => console.error("Fatal:", err.message))
