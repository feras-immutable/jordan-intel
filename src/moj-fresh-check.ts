import axios from "axios"
import https from "https"

const agent = new https.Agent({ rejectUnauthorized: false })

async function main() {
  // Get fresh homepage
  const home = await axios.get("https://auctions.moj.gov.jo/", { httpsAgent: agent, timeout: 15000 })
  const tokens = home.data.match(/AuctionsList\.aspx\?token=[^"&]+/g) || []
  console.log("Fresh tokens:", tokens.length)

  if (tokens.length === 0) {
    console.log("No tokens found. Page length:", home.data.length)
    console.log("Title:", home.data.match(/<title>([^<]+)/)?.[1])
    // Check if page is a login redirect
    if (home.data.includes("login") || home.data.includes("تسجيل")) {
      console.log("Page appears to be a login page")
    }
    return
  }

  // Fetch first category
  const firstUrl = "https://auctions.moj.gov.jo/" + tokens[0]
  console.log("\nFetching:", firstUrl.slice(0, 80))
  const listResp = await axios.get(firstUrl, { httpsAgent: agent, timeout: 20000 })

  // Check for SetCurrentAuctionID
  const setIds = listResp.data.match(/SetCurrentAuctionID\(\d+\)/g) || []
  console.log("SetCurrentAuctionID:", setIds.length)
  for (const s of setIds.slice(0, 3)) console.log("  " + s)

  // Check for SetAuctionData
  const setData = listResp.data.match(/SetAuctionData\([^)]+\)/g) || []
  console.log("SetAuctionData:", setData.length)
  for (const s of setData.slice(0, 3)) console.log("  " + s)

  // Check for price/value fields in the page
  const text = listResp.data.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
  const valueMatches = text.match(/القيمة[^.]{0,60}/g) || []
  console.log("\nValue mentions:", valueMatches.length)
  for (const v of [...new Set(valueMatches)].slice(0, 5)) console.log("  " + v.trim())
}

main().catch(err => console.error("Fatal:", err.message))
