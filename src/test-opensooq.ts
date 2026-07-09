import axios from "axios"
import * as cheerio from "cheerio"

function extractParcel(text: string) {
  // Basin patterns
  const basinPatterns = [
    /حوض\s+([^\d,،\n(]+?)(?:\s*(?:رقم|#)?\s*\(?\s*(\d+)\s*\)?)/i,
    /حوض\s*(?:رقم|#)?\s*\(?\s*(\d+)\s*\)?/i,
    /حوض\s*:?\s*([^\n,،]+)/i,
  ]
  let basin: string | null = null
  let basinNum: number | null = null
  for (const pat of basinPatterns) {
    const m = text.match(pat)
    if (m) {
      if (m[2]) { basin = m[1]?.trim(); basinNum = parseInt(m[2]) }
      else if (/^\d+$/.test(m[1]?.trim())) { basinNum = parseInt(m[1].trim()) }
      else { basin = m[1]?.trim() }
      break
    }
  }

  // Parcel patterns
  const parcelPatterns = [
    /قطعة\s*(?:رقم\s*)?(?:\(\s*)?(\d+)/i,
    /قطعه\s*(?:رقم\s*)?(?:\(\s*)?(\d+)/i,
    /رقم القطعة\s*:?\s*(\d+)/i,
    /رقم\s*القطعه\s*:?\s*(\d+)/i,
  ]
  let parcel: number | null = null
  for (const pat of parcelPatterns) {
    const m = text.match(pat)
    if (m) { parcel = parseInt(m[1]); break }
  }

  // Village patterns
  const villagePatterns = [
    /قرية\s+([^\n,،(]+)/i,
    /أراضي\s+([^\n,،(]+)/i,
  ]
  let village: string | null = null
  for (const pat of villagePatterns) {
    const m = text.match(pat)
    if (m) { village = m[1]?.trim(); break }
  }

  return { basin, basinNum, parcel, village }
}

async function fetchOpenSooqListing(url: string): Promise<{ title: string; desc: string; price: string } | null> {
  try {
    const resp = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Language": "ar",
      },
      timeout: 15000,
    })
    const $ = cheerio.load(resp.data)

    // Extract from JSON-LD
    const jsonLd = $('script[type="application/ld+json"]').first().html()
    if (jsonLd) {
      try {
        const ld = JSON.parse(jsonLd)
        const desc = ld.description || ld.mainEntity?.description || ""
        const title = ld.name || ""
        const price = ld.mainEntity?.offers?.price || ld.offers?.price || ""
        return { title, desc, price: String(price) }
      } catch { /* fall through */ }
    }

    // Fallback: extract from page text
    const title = $("h1").first().text().trim()
    const desc = $("[class*='description'], [class*='details'], .postContent").text().trim()
    const price = $("[class*='price']").first().text().trim()
    return { title, desc: desc.slice(0, 1000), price }
  } catch (err: any) {
    console.log(`  FETCH FAILED: ${err.message}`)
    return null
  }
}

async function main() {
  console.log("=== OPENSOOQ PARCEL DATA TEST ===\n")

  // First, get land listing URLs from the OpenSooq land category
  const listUrl = "https://jo.opensooq.com/en/real-estate-for-sale/lands-for-sale/amman"
  console.log(`Fetching listing page: ${listUrl}\n`)

  let listingUrls: string[] = []
  try {
    const resp = await axios.get(listUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      timeout: 15000,
    })
    const $ = cheerio.load(resp.data)

    // Find listing links
    $("a[href*='/post/']").each((_, el) => {
      const href = $(el).attr("href")
      if (href && !listingUrls.includes(href)) {
        const full = href.startsWith("http") ? href : `https://jo.opensooq.com${href}`
        listingUrls.push(full)
      }
    })

    // Also try JSON-LD for listing URLs
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const ld = JSON.parse($(el).html() || "")
        if (ld.itemListElement) {
          for (const item of ld.itemListElement) {
            if (item.url && item.url.includes("/post/")) {
              if (!listingUrls.includes(item.url)) listingUrls.push(item.url)
            }
          }
        }
      } catch { /* skip */ }
    })
  } catch (err: any) {
    console.log(`List page failed: ${err.message}`)
  }

  console.log(`Found ${listingUrls.length} listing URLs\n`)

  // Take first 15
  const toTest = listingUrls.slice(0, 15)

  let hasBasin = 0
  let hasParcel = 0
  let hasBoth = 0
  let hasVillage = 0
  let tested = 0

  for (const url of toTest) {
    tested++
    console.log(`${tested}. ${url.split("/").pop()}`)

    const data = await fetchOpenSooqListing(url)
    if (!data) continue

    const allText = `${data.title} ${data.desc}`
    const { basin, basinNum, parcel, village } = extractParcel(allText)

    if (basin || basinNum) hasBasin++
    if (parcel) hasParcel++
    if ((basin || basinNum) && parcel) hasBoth++
    if (village) hasVillage++

    console.log(`  Title: ${data.title.slice(0, 70)}`)
    console.log(`  Desc: ${data.desc.slice(0, 120).replace(/\n/g, " ")}`)
    console.log(`  Price: ${data.price}`)
    console.log(`  Village: ${village || "—"} | Basin: ${basin || "—"} (#${basinNum || "—"}) | Parcel: ${parcel || "—"}`)
    if ((basin || basinNum) && parcel) console.log(`  ✓ RESOLVABLE`)
    console.log()

    await new Promise(r => setTimeout(r, 800))
  }

  console.log("=== OPENSOOQ RESULTS ===")
  console.log(`Tested: ${tested}`)
  console.log(`Has basin: ${hasBasin} (${Math.round(hasBasin / tested * 100)}%)`)
  console.log(`Has parcel: ${hasParcel} (${Math.round(hasParcel / tested * 100)}%)`)
  console.log(`Has village: ${hasVillage} (${Math.round(hasVillage / tested * 100)}%)`)
  console.log(`Has both basin+parcel (resolvable): ${hasBoth} (${Math.round(hasBoth / tested * 100)}%)`)
  console.log()
  console.log("Compare to Bayut: 8% resolvable from descriptions")
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1) })
