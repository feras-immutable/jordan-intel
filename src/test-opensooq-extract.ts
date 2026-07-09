import axios from "axios"
import * as cheerio from "cheerio"

async function main() {
  const resp = await axios.get("https://jo.opensooq.com/ar/real-estate-for-sale/lands-for-sale", {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    timeout: 15000,
  })
  const $ = cheerio.load(resp.data)

  // Get the second JSON-LD block (the graph with listings)
  const scripts = $('script[type="application/ld+json"]')
  for (let i = 0; i < scripts.length; i++) {
    const text = $(scripts[i]).html() || ""
    try {
      const ld = JSON.parse(text)
      if (ld["@graph"]) {
        for (const item of ld["@graph"]) {
          if (item.itemListElement) {
            console.log(`Found itemListElement with ${item.itemListElement.length} items\n`)
            // Show first 5 items
            for (const li of item.itemListElement.slice(0, 5)) {
              console.log(`${li.position}. ${li.item?.name?.slice(0, 70)}`)
              console.log(`   URL: ${li.item?.url}`)
              console.log(`   Price: ${li.item?.offers?.price} ${li.item?.offers?.priceCurrency}`)
              console.log()
            }
            // Get detail page for first 10
            console.log("=== FETCHING DETAIL PAGES ===\n")
            let hasBasin = 0, hasParcel = 0, hasBoth = 0, tested = 0
            for (const li of item.itemListElement.slice(0, 15)) {
              const url = li.item?.url
              if (!url) continue
              tested++
              try {
                const dr = await axios.get(url, {
                  headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
                  timeout: 10000,
                })
                const $d = cheerio.load(dr.data)
                let desc = ""
                $d('script[type="application/ld+json"]').each((_, el) => {
                  try {
                    const dld = JSON.parse($d(el).html() || "")
                    if (dld["@graph"]) {
                      for (const g of dld["@graph"]) {
                        if (g.description) desc = g.description
                      }
                    }
                    if (dld.description) desc = dld.description
                  } catch {}
                })
                if (!desc) desc = $d("body").text().slice(0, 2000)

                const basinM = desc.match(/حوض\s+([^\d,،\n(]{2,20}?)(?:\s*(?:رقم|#)?\s*\(?\s*(\d+)\s*\)?)/i)
                  || desc.match(/حوض\s*:?\s*([^\n,،]{2,20})/i)
                const parcelM = desc.match(/قطعة?\s*(?:رقم\s*)?(?:\(\s*)?(\d+)/i)
                  || desc.match(/رقم القطعة?\s*:?\s*(\d+)/i)

                const basin = basinM ? (basinM[1]?.trim() || "yes") : null
                const parcel = parcelM ? parseInt(parcelM[1]) : null
                if (basin) hasBasin++
                if (parcel) hasParcel++
                if (basin && parcel) hasBoth++

                console.log(`${tested}. ${li.item?.name?.slice(0, 60)}`)
                console.log(`   Desc: ${desc.slice(0, 100).replace(/\s+/g, " ")}`)
                console.log(`   Basin: ${basin || "—"} | Parcel: ${parcel || "—"}`)
                if (basin && parcel) console.log(`   ✓ RESOLVABLE`)
              } catch (err: any) {
                console.log(`${tested}. FAILED: ${err.message}`)
              }
              console.log()
              await new Promise(r => setTimeout(r, 800))
            }

            console.log("=== OPENSOOQ RESULTS ===")
            console.log(`Tested: ${tested}`)
            console.log(`Has basin: ${hasBasin} (${Math.round(hasBasin / tested * 100)}%)`)
            console.log(`Has parcel: ${hasParcel} (${Math.round(hasParcel / tested * 100)}%)`)
            console.log(`Has both (resolvable): ${hasBoth} (${Math.round(hasBoth / tested * 100)}%)`)
            console.log(`\nCompare: Bayut = 8%`)
            return
          }
        }
      }
    } catch {}
  }
  console.log("No itemListElement found")
}

main().catch(err => console.error("Fatal:", err.message))
