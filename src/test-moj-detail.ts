import axios from "axios"
import * as cheerio from "cheerio"
import https from "https"

const agent = new https.Agent({ rejectUnauthorized: false })

async function main() {
  // First get the land list page to capture ViewState
  const landToken = "4qy8OuhsH9jUT7LUpUd0vrrej7DZFIlrYUbJDNhy_E3Q3Hxei9O5hIhNPUTv2JN03pl_whWDUDInBYIvXX4lvdTwiPaw7yNJ4we5qp0TYFE"
  const url = `https://auctions.moj.gov.jo/AuctionsList.aspx?token=${landToken}`

  const listResp = await axios.get(url, {
    httpsAgent: agent,
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    timeout: 20000,
  })

  const $ = cheerio.load(listResp.data)
  const viewState = $("input[name='__VIEWSTATE']").val() as string
  const viewStateGen = $("input[name='__VIEWSTATEGENERATOR']").val() as string || ""

  // Find the first auction's detail postback target
  // Format: __doPostBack('ctl00$cph_Base$AuctionsListRepeater$ctl00$lbtnDetails','')
  const detailTarget = listResp.data.match(/__doPostBack\('([^']*lbtnDetails[^']*)'/)?.[1]
  console.log("Detail postback target:", detailTarget)

  if (!detailTarget) {
    console.log("No detail target found")
    return
  }

  // Try posting to get the detail view
  console.log("\nPosting for detail view...")
  const detailResp = await axios.post(url, new URLSearchParams({
    "__VIEWSTATE": viewState,
    "__VIEWSTATEGENERATOR": viewStateGen,
    "__EVENTTARGET": detailTarget,
    "__EVENTARGUMENT": "",
  }).toString(), {
    httpsAgent: agent,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer": url,
    },
    timeout: 20000,
  })

  const detailHtml = detailResp.data
  console.log("Response length:", detailHtml.length)

  // Check for price-related text in the detail response
  const text = detailHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

  // Look for price patterns
  const pricePatterns = [
    /القيمة المقدرة\s*:?\s*([\d,]+(?:\.\d+)?)/i,
    /القيمة الافتتاحية\s*:?\s*([\d,]+(?:\.\d+)?)/i,
    /القيمة الحالية\s*:?\s*([\d,]+(?:\.\d+)?)/i,
    /قيمة المزاد\s*:?\s*([\d,]+(?:\.\d+)?)/i,
    /المبلغ\s*:?\s*([\d,]+(?:\.\d+)?)/i,
    /ثمن\s*:?\s*([\d,]+(?:\.\d+)?)/i,
  ]

  console.log("\n=== PRICE DATA IN DETAIL VIEW ===")
  for (const pat of pricePatterns) {
    const match = text.match(pat)
    if (match) console.log(`  ${pat.source}: ${match[1]}`)
  }

  // Also look for any amounts
  const amounts = text.match(/([\d,]{3,}(?:\.\d+)?)\s*(?:دينار|JOD|JD)/gi) || []
  console.log("\nCurrency amounts:", amounts.slice(0, 10))

  // Large numbers
  const nums = text.match(/\b([\d,]{4,})\b/g) || []
  const uniqueNums = [...new Set(nums)].filter(n => parseInt(n.replace(/,/g, "")) > 1000)
  console.log("\nLarge numbers:", uniqueNums.slice(0, 10))

  // Look for bid-related info
  const bidPatterns = text.match(/(?:المزايد|مزايد|المبلغ|القيمة|الحالي|عدد|مزاد)[^.]{0,80}/gi) || []
  console.log("\nBid-related text:")
  for (const b of [...new Set(bidPatterns)].slice(0, 10)) console.log(`  ${b.trim().slice(0, 100)}`)
}

main().catch(err => console.error("Fatal:", err.message))
