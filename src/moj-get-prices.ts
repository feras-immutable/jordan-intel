import axios from "axios"
import * as cheerio from "cheerio"
import https from "https"

const agent = new https.Agent({ rejectUnauthorized: false })

async function getSession(): Promise<string> {
  const r = await axios.get("https://auctions.moj.gov.jo/", {
    httpsAgent: agent,
    timeout: 15000,
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  })
  return r.headers["set-cookie"]?.map((c: string) => c.split(";")[0]).join("; ") || ""
}

async function main() {
  // Get session cookies
  console.log("Getting session...")
  const cookies = await getSession()
  console.log("Cookies:", cookies.slice(0, 60))

  // Get homepage with cookies to get fresh tokens
  const home = await axios.get("https://auctions.moj.gov.jo/", {
    httpsAgent: agent,
    timeout: 15000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Cookie": cookies,
    },
  })

  const tokens = home.data.match(/AuctionsList\.aspx\?token=([^"&]+)/g) || []
  console.log("Tokens:", tokens.length)

  if (tokens.length === 0) return

  // Get the land list page
  const landUrl = "https://auctions.moj.gov.jo/" + tokens[1] // Land is usually the second token
  console.log("\nFetching land auctions:", landUrl.slice(0, 80))

  const listResp = await axios.get(landUrl, {
    httpsAgent: agent,
    timeout: 20000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Cookie": cookies,
    },
  })

  const html = listResp.data
  console.log("Page length:", html.length)

  // Find SetAuctionData and SetCurrentAuctionID
  const setData = html.match(/SetAuctionData\([^)]+\)/g) || []
  console.log("SetAuctionData:", setData.length)
  for (const s of setData.slice(0, 3)) console.log("  " + s)

  const setIds = html.match(/SetCurrentAuctionID\(\d+\)/g) || []
  console.log("SetCurrentAuctionID:", setIds.length)

  // Look for value/price fields in the rendered content
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

  // Find all numbers that could be prices (5+ digits)
  const bigNums = text.match(/\b[\d,]{5,}\b/g) || []
  console.log("\nNumbers 5+ digits:", [...new Set(bigNums)].slice(0, 15))

  // Search for value-related Arabic text
  const valueContexts = text.match(/(?:القيمة|المقدرة|الافتتاحي|الحالية|المبلغ|ثمن)[^.]{0,50}/g) || []
  console.log("\nValue mentions:")
  for (const v of [...new Set(valueContexts)].slice(0, 10)) console.log("  " + v.trim())

  // Search for any hidden value containers
  const $ = cheerio.load(html)
  $("[id*=Value], [id*=Price], [id*=Bid], [id*=Amount], [id*=val], [id*=price]").each((_, el) => {
    const id = $(el).attr("id")
    const val = $(el).text().trim() || $(el).attr("value")
    if (val) console.log(`\nHidden field ${id}: "${val}"`)
  })

  // Check the detail postback targets
  const detailTargets = html.match(/__doPostBack\('([^']*Details[^']*)'/g) || []
  console.log("\nDetail postback targets:", detailTargets.length)
  for (const d of detailTargets.slice(0, 3)) console.log("  " + d)

  // If we found a detail target, try posting
  if (detailTargets[0]) {
    const target = detailTargets[0].match(/__doPostBack\('([^']+)'/)?.[1]
    if (target) {
      console.log("\n=== TRYING DETAIL POSTBACK ===")
      console.log("Target:", target)

      const viewState = $("input[name='__VIEWSTATE']").val() as string
      const viewStateGen = $("input[name='__VIEWSTATEGENERATOR']").val() as string || ""

      const detailResp = await axios.post(landUrl, new URLSearchParams({
        "__VIEWSTATE": viewState,
        "__VIEWSTATEGENERATOR": viewStateGen,
        "__EVENTTARGET": target,
        "__EVENTARGUMENT": "",
      }).toString(), {
        httpsAgent: agent,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          "Content-Type": "application/x-www-form-urlencoded",
          "Cookie": cookies,
          "Referer": landUrl,
        },
        timeout: 20000,
      })

      const detailText = detailResp.data.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

      // Look for price data in detail response
      const detailValues = detailText.match(/(?:القيمة|المقدرة|الافتتاحي|الحالية|المبلغ)[^.]{0,80}/g) || []
      console.log("\nDetail value mentions:")
      for (const v of [...new Set(detailValues)].slice(0, 10)) console.log("  " + v.trim())

      const detailNums = detailText.match(/\b[\d,]{5,}\b/g) || []
      console.log("\nDetail large numbers:", [...new Set(detailNums)].slice(0, 10))
    }
  }
}

main().catch(err => console.error("Fatal:", err.message))
