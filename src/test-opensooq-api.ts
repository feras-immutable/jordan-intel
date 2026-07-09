import axios from "axios"
import * as cheerio from "cheerio"

async function main() {
  // The Arabic land page works — let's extract data from it
  const resp = await axios.get("https://jo.opensooq.com/ar/real-estate-for-sale/lands-for-sale", {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    timeout: 15000,
  })
  const html = resp.data
  const $ = cheerio.load(html)

  // Check JSON-LD
  $('script[type="application/ld+json"]').each((i, el) => {
    try {
      const ld = JSON.parse($(el).html() || "")
      if (ld.itemListElement) {
        console.log(`JSON-LD ItemList: ${ld.numberOfItems} items`)
        console.log(`First 3 items:`)
        for (const item of ld.itemListElement.slice(0, 3)) {
          console.log(`  ${item.name?.slice(0, 60)}`)
          console.log(`  URL: ${item.url}`)
          console.log(`  Price: ${item.offers?.price} ${item.offers?.priceCurrency}`)
          console.log()
        }
      }
    } catch { /* skip */ }
  })

  // Look for API calls in script tags
  const scriptContent = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || []
  for (let i = 0; i < scriptContent.length; i++) {
    const s = scriptContent[i]
    if (s.includes("api") || s.includes("endpoint") || s.includes("fetch")) {
      const apiMatches = s.match(/https?:\/\/[^"'\s]+(?:api|v\d)[^"'\s]*/gi) || []
      if (apiMatches.length > 0) {
        console.log(`Script ${i} API URLs:`, [...new Set(apiMatches)].slice(0, 5))
      }
    }
  }

  // Now fetch a few individual listing detail pages from the JSON-LD URLs
  const jsonLdScript = $('script[type="application/ld+json"]').first().html()
  if (!jsonLdScript) { console.log("No JSON-LD"); return }

  const ld = JSON.parse(jsonLdScript)
  const items = ld.itemListElement || []
  console.log(`\n=== TESTING ${Math.min(items.length, 10)} INDIVIDUAL LISTINGS ===\n`)

  let hasBasin = 0
  let hasParcel = 0
  let hasBoth = 0
  let tested = 0

  for (const item of items.slice(0, 10)) {
    tested++
    const url = item.url
    if (!url) continue

    try {
      const detailResp = await axios.get(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        timeout: 10000,
      })
      const $d = cheerio.load(detailResp.data)

      // Get description from JSON-LD or page content
      let desc = ""
      $d('script[type="application/ld+json"]').each((_, el) => {
        try {
          const dld = JSON.parse($d(el).html() || "")
          if (dld.description) desc = dld.description
          if (dld.mainEntity?.description) desc = dld.mainEntity.description
        } catch { /* skip */ }
      })

      if (!desc) {
        desc = $d("body").text().slice(0, 2000)
      }

      // Extract parcel info
      const basinMatch = desc.match(/حوض\s+([^\d,،\n(]+?)(?:\s*(?:رقم|#)?\s*\(?\s*(\d+)\s*\)?)/i)
        || desc.match(/حوض\s*:?\s*([^\n,،]+)/i)
      const parcelMatch = desc.match(/قطعة\s*(?:رقم\s*)?(?:\(\s*)?(\d+)/i)
        || desc.match(/قطعه\s*(?:رقم\s*)?(?:\(\s*)?(\d+)/i)

      const basin = basinMatch ? (basinMatch[1]?.trim() || basinMatch[0]) : null
      const parcel = parcelMatch ? parseInt(parcelMatch[1]) : null

      if (basin) hasBasin++
      if (parcel) hasParcel++
      if (basin && parcel) hasBoth++

      console.log(`${tested}. ${item.name?.slice(0, 60)}`)
      console.log(`   Price: ${item.offers?.price} ${item.offers?.priceCurrency || ""}`)
      console.log(`   Desc: ${desc.slice(0, 120).replace(/\n/g, " ")}`)
      console.log(`   Basin: ${basin || "—"} | Parcel: ${parcel || "—"}`)
      if (basin && parcel) console.log(`   ✓ RESOLVABLE`)
      console.log()
    } catch (err: any) {
      console.log(`${tested}. FETCH FAILED: ${err.message}`)
      console.log()
    }

    await new Promise(r => setTimeout(r, 800))
  }

  console.log("=== OPENSOOQ RESULTS ===")
  console.log(`Tested: ${tested}`)
  console.log(`Has basin: ${hasBasin} (${Math.round(hasBasin / tested * 100)}%)`)
  console.log(`Has parcel: ${hasParcel} (${Math.round(hasParcel / tested * 100)}%)`)
  console.log(`Has both (resolvable): ${hasBoth} (${Math.round(hasBoth / tested * 100)}%)`)
  console.log(`\nCompare: Bayut = 8% resolvable`)
}

main().catch(err => console.error("Fatal:", err.message))
