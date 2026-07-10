import axios from "axios"
import https from "https"

const agent = new https.Agent({ rejectUnauthorized: false })

async function main() {
  const landToken = "4qy8OuhsH9jUT7LUpUd0vrrej7DZFIlrYUbJDNhy_E3Q3Hxei9O5hIhNPUTv2JN03pl_whWDUDInBYIvXX4lvdTwiPaw7yNJ4we5qp0TYFE"
  const url = `https://auctions.moj.gov.jo/AuctionsList.aspx?token=${landToken}`

  const r = await axios.get(url, {
    httpsAgent: agent,
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    timeout: 20000,
  })

  const html = r.data

  // Find all text around price-related Arabic words
  const pricePatterns = [
    /القيمة[^<]{0,200}/gi,
    /المقدرة[^<]{0,100}/gi,
    /الافتتاحي[^<]{0,100}/gi,
    /الحالية[^<]{0,100}/gi,
    /المبلغ[^<]{0,100}/gi,
  ]

  console.log("=== PRICE-RELATED TEXT IN RAW HTML ===\n")
  for (const pat of pricePatterns) {
    const matches = html.match(pat) || []
    if (matches.length > 0) {
      console.log(`Pattern: ${pat.source}`)
      for (const m of [...new Set(matches)].slice(0, 5)) {
        console.log(`  ${m.trim().slice(0, 120)}`)
      }
      console.log()
    }
  }

  // Also check for currency amounts (numbers near JOD/دينار)
  const amountPatterns = html.match(/[\d,]+(?:\.\d+)?\s*(?:دينار|JOD|JD)/gi) || []
  console.log("Currency amounts:", amountPatterns.slice(0, 10))

  // Check for any large numbers that could be prices
  const bigNumbers = html.match(/>\s*([\d,]{4,})\s*</g) || []
  console.log("\nLarge numbers in HTML:", [...new Set(bigNumbers)].slice(0, 10))

  // Check for hidden divs or collapsed sections with price data
  const hiddenSections = html.match(/display:\s*none[^>]*>[^<]*(?:القيمة|المقدرة|الافتتاحي|المبلغ)[^<]*/gi) || []
  console.log("\nHidden price sections:", hiddenSections.length)
  for (const h of hiddenSections.slice(0, 3)) console.log(`  ${h.slice(0, 150)}`)

  // Check for AJAX/postback targets related to values
  const valueTargets = html.match(/__doPostBack\([^)]*(?:Value|Price|Bid|value|price|bid|قيمة|مبلغ)[^)]*\)/gi) || []
  console.log("\nValue-related postbacks:", valueTargets.slice(0, 5))

  // Look for the bidding section
  const bidSection = html.match(/المزايد[^<]{0,200}/gi) || []
  console.log("\nBid sections:", bidSection.slice(0, 3).map(s => s.slice(0, 100)))
}

main().catch(err => console.error("Fatal:", err.message))
