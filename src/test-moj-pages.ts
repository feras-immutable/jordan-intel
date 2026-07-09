import axios from "axios"
import * as cheerio from "cheerio"
import https from "https"

const agent = new https.Agent({ rejectUnauthorized: false })

async function main() {
  // Fetch land category first page
  const landToken = "4qy8OuhsH9jUT7LUpUd0vrrej7DZFIlrYUbJDNhy_E3Q3Hxei9O5hIhNPUTv2JN03pl_whWDUDInBYIvXX4lvdTwiPaw7yNJ4we5qp0TYFE"
  const url = `https://auctions.moj.gov.jo/AuctionsList.aspx?token=${landToken}`

  const r = await axios.get(url, {
    httpsAgent: agent,
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    timeout: 20000,
  })
  const $ = cheerio.load(r.data)

  // Find pagination elements
  console.log("=== PAGINATION ANALYSIS ===\n")

  // Check for page number links
  const pageLinks = $("a[href*='Page']").length
  console.log("Page links (href contains 'Page'):", pageLinks)

  // Check for Next/Previous buttons
  $("a, input[type=submit]").each((_, el) => {
    const text = $(el).text().trim()
    const href = $(el).attr("href") || ""
    const onclick = $(el).attr("onclick") || ""
    if (text.includes("التالي") || text.includes("Next") || text.includes(">>") || text.includes("السابق") || text.includes("...") || text.match(/^\d+$/)) {
      console.log(`  "${text}" href="${href.slice(0, 80)}" onclick="${onclick.slice(0, 80)}"`)
    }
  })

  // Check for __doPostBack pagination
  const postbackPages = r.data.match(/__doPostBack\([^)]*[Pp]age[^)]*\)/g) || []
  console.log("\nPostback page controls:", postbackPages.length)
  for (const p of postbackPages.slice(0, 5)) console.log("  " + p.slice(0, 100))

  // Look for total record count
  const countMatches = r.data.match(/(\d+)\s*(?:نتيجة|سجل|record|من)/gi) || []
  console.log("\nCount mentions:", countMatches.slice(0, 5))

  // Check for DataPager or GridView pager
  const pagerElements = $("[id*=pager], [id*=Pager], [id*=DataPager], [id*=PageNavigator], [class*=pager], [class*=pagination]")
  console.log("\nPager elements:", pagerElements.length)
  pagerElements.each((_, el) => {
    console.log("  ID:", $(el).attr("id"), "Class:", $(el).attr("class"), "Text:", $(el).text().trim().slice(0, 100))
  })

  // Count auction blocks (رقم المزاد) on this page
  const auctionCount = (r.data.match(/رقم المزاد\s*:/g) || []).length
  console.log("\nAuctions on this page:", auctionCount)

  // Look for "show more" or "load more" or scroll-based loading
  const loadMore = r.data.match(/load\s*more|show\s*more|المزيد|عرض المزيد/gi) || []
  console.log("Load more patterns:", loadMore)

  // Check for AJAX/scroll loading scripts
  const scrollLoad = r.data.match(/scroll|infinite|lazy|append|loadMore/gi) || []
  console.log("Scroll/lazy patterns:", [...new Set(scrollLoad)].slice(0, 5))

  // Extract ViewState for postback pagination
  const viewState = $("input[name='__VIEWSTATE']").val()
  const viewStateGen = $("input[name='__VIEWSTATEGENERATOR']").val()
  const eventValidation = $("input[name='__EVENTVALIDATION']").val()
  console.log("\nViewState present:", !!viewState, "length:", String(viewState || "").length)
  console.log("EventValidation present:", !!eventValidation)

  // Try to find paging postback targets
  const pagingTargets = r.data.match(/__doPostBack\('([^']*)',\s*'([^']*)'\)/g) || []
  const pageRelated = pagingTargets.filter((t: string) => t.includes("Page") || t.includes("page") || t.includes("Next") || t.includes("next"))
  console.log("\nPaging-related postbacks:", pageRelated.length)
  for (const p of pageRelated.slice(0, 5)) console.log("  " + p)

  // Also check — maybe all auctions are loaded on one page but collapsed
  const allAuctionIds = r.data.match(/SetCurrentAuctionID\((\d+)\)/g) || []
  console.log("\nTotal auction IDs on page:", allAuctionIds.length)
  console.log("Unique:", new Set(allAuctionIds.map((m: string) => m.match(/\d+/)?.[0])).size)
}

main().catch(err => console.error("Fatal:", err.message))
