import axios from "axios"
import https from "https"

const agent = new https.Agent({ rejectUnauthorized: false })

async function main() {
  const url = "https://auctions.moj.gov.jo/AuctionsList.aspx?token=4qy8OuhsH9jUT7LUpUd0vrrej7DZFIlrYUbJDNhy_E3Q3Hxei9O5hIhNPUTv2JN03pl_whWDUDInBYIvXX4lvdTwiPaw7yNJ4we5qp0TYFE"
  const r = await axios.get(url, { httpsAgent: agent, timeout: 20000 })
  const html = r.data

  // SetAuctionData — contains numeric IDs that might be used to fetch prices
  const setData = html.match(/SetAuctionData\([^)]+\)/g) || []
  console.log("SetAuctionData calls:", setData.length)
  for (const s of [...new Set(setData)].slice(0, 5)) console.log("  " + s)

  // SetCurrentAuctionID
  const setId = html.match(/SetCurrentAuctionID\(\d+\)/g) || []
  console.log("\nSetCurrentAuctionID calls:", setId.length)
  for (const s of [...new Set(setId)].slice(0, 5)) console.log("  " + s)

  // All JavaScript function definitions
  const funcs = html.match(/function\s+\w+\s*\([^)]*\)/g) || []
  console.log("\nJS functions defined:", funcs.length)
  for (const f of funcs) console.log("  " + f)

  // Look for $.ajax or fetch calls
  const ajaxCalls = html.match(/\$\.(?:ajax|get|post)\s*\(/g) || []
  console.log("\njQuery AJAX calls:", ajaxCalls.length)

  const fetchCalls = html.match(/fetch\s*\(/g) || []
  console.log("fetch() calls:", fetchCalls.length)

  // Look for WebService or WebMethod references
  const webService = html.match(/\.asmx|WebService|WebMethod|PageMethod/gi) || []
  console.log("WebService references:", [...new Set(webService)])

  // Find the SetAuctionData function definition
  const setAuctionDataFunc = html.match(/function\s+SetAuctionData[^}]+}/s)
  if (setAuctionDataFunc) {
    console.log("\nSetAuctionData function body:")
    console.log(setAuctionDataFunc[0].slice(0, 300))
  }

  // Look for any URL-like patterns in inline scripts
  const inlineUrls = html.match(/['"]\/[^'"]+\.as[hp]x[^'"]*['"]/g) || []
  console.log("\nASP.NET URL references:", [...new Set(inlineUrls)].slice(0, 10))

  // Check for hidden fields with bid/price data
  const hiddenFields = html.match(/id="[^"]*(?:hdn|hidden|val|Value|Price|Bid)[^"]*"[^>]*>/gi) || []
  console.log("\nHidden fields:", hiddenFields.length)
  for (const h of hiddenFields.slice(0, 5)) console.log("  " + h.slice(0, 100))

  // Get all script blocks and search for price/bid keywords
  const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || []
  for (let i = 0; i < scripts.length; i++) {
    const s = scripts[i]
    if (s.includes("SetAuction") || s.includes("Bid") || s.includes("Value") || s.includes("Price")) {
      console.log(`\nScript #${i} (${s.length} chars) contains price/bid keywords:`)
      // Extract relevant lines
      const lines = s.split("\n").filter(l =>
        l.includes("SetAuction") || l.includes("Bid") || l.includes("Value") ||
        l.includes("Price") || l.includes("ajax") || l.includes("fetch") ||
        l.includes("hdn") || l.includes("القيمة")
      )
      for (const l of lines.slice(0, 10)) console.log("  " + l.trim().slice(0, 120))
    }
  }
}

main().catch(err => console.error("Fatal:", err.message))
