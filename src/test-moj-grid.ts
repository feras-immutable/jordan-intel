import axios from "axios"
import * as cheerio from "cheerio"
import https from "https"

const agent = new https.Agent({ rejectUnauthorized: false })

async function main() {
  // Land/Complex category
  const landUrl = "https://auctions.moj.gov.jo/AuctionsList.aspx?token=4qy8OuhsH9jUT7LUpUd0vrrej7DZFIlrYUbJDNhy_E3Q3Hxei9O5hIhNPUTv2JN03pl_whWDUDInBYIvXX4lvdTwiPaw7yNJ4we5qp0TYFE"

  const r = await axios.get(landUrl, {
    httpsAgent: agent,
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    timeout: 15000,
  })
  const $ = cheerio.load(r.data)

  // Get the raw HTML of the grid area
  console.log("=== MOJ LAND AUCTIONS ===\n")

  // Find all repeater/grid items
  const items = $("[id*=rpt] > div, [id*=grd] tr, .auction-card, .panel").filter((_, el) => {
    return $(el).text().length > 50
  })

  console.log(`Grid items found: ${items.length}\n`)

  // Extract data from each item
  items.each((i, el) => {
    if (i >= 5) return // Show first 5

    const text = $(el).text().replace(/\s+/g, " ").trim()
    console.log(`--- Item ${i + 1} ---`)
    console.log(text.slice(0, 300))

    // Try to find specific fields
    const html = $(el).html() || ""
    const priceMatch = html.match(/القيمة[^<]*<[^>]*>([^<]+)/i)
    const openMatch = html.match(/الافتتاحي[^<]*<[^>]*>([^<]+)/i)
    const currentMatch = html.match(/الحالية[^<]*<[^>]*>([^<]+)/i)
    const bidMatch = html.match(/عدد المزايدات[^<]*<[^>]*>([^<]+)/i)

    if (priceMatch) console.log(`  Estimated: ${priceMatch[1].trim()}`)
    if (openMatch) console.log(`  Opening: ${openMatch[1].trim()}`)
    if (currentMatch) console.log(`  Current: ${currentMatch[1].trim()}`)
    if (bidMatch) console.log(`  Bids: ${bidMatch[1].trim()}`)

    // Look for parcel info
    const villMatch = text.match(/قرية[:\s]+([^\s,،]+)/i)
    const basinMatch = text.match(/حوض[:\s]+([^\s,،]+)/i)
    const parcelMatch = text.match(/قطعة[:\s]+(\d+)/i)
    if (villMatch) console.log(`  Village: ${villMatch[1]}`)
    if (basinMatch) console.log(`  Basin: ${basinMatch[1]}`)
    if (parcelMatch) console.log(`  Parcel: ${parcelMatch[1]}`)

    console.log()
  })

  // Also check what detail page links look like
  console.log("=== DETAIL LINKS ===")
  $("a, input[type=submit], [onclick]").each((_, el) => {
    const onclick = $(el).attr("onclick") || ""
    const href = $(el).attr("href") || ""
    if (onclick.includes("Auction") || href.includes("Auction") || onclick.includes("__doPost")) {
      console.log(`  ${el.tagName} onclick="${onclick.slice(0, 100)}" href="${href.slice(0, 100)}"`)
    }
  })

  // Try to find the raw data in ASP.NET ViewState or hidden fields
  const viewState = r.data.match(/__VIEWSTATE[^"]*"[^"]*value="([^"]{0,100})/)?.[1]
  console.log(`\nViewState present: ${viewState ? "yes (" + viewState.length + " chars)" : "no"}`)

  // Check for JSON data
  const jsonBlocks = r.data.match(/\{[^{}]*"auction[^{}]*\}/gi) || []
  console.log(`JSON auction blocks: ${jsonBlocks.length}`)

  // Show page size info
  const pageInfo = r.data.match(/(?:page|صفحة)\s*(\d+)\s*(?:of|من)\s*(\d+)/i)
  console.log(`Pagination: ${pageInfo ? pageInfo[0] : "not found"}`)
  const totalRecords = r.data.match(/(\d+)\s*(?:نتائج|records|سجل)/i)
  console.log(`Total records: ${totalRecords ? totalRecords[0] : "not found"}`)
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1) })
