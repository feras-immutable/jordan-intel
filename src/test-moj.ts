import axios from "axios"
import * as cheerio from "cheerio"
import https from "https"

const agent = new https.Agent({ rejectUnauthorized: false })

async function main() {
  // First get the homepage to find category tokens
  const homeResp = await axios.get("https://auctions.moj.gov.jo/", {
    httpsAgent: agent,
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    timeout: 15000,
  })

  // Extract all category tokens from the homepage
  const tokenMatches = homeResp.data.match(/AuctionsList\.aspx\?token=([^"&]+)/g) || []
  console.log("Category tokens found:", tokenMatches.length)
  for (const t of tokenMatches) console.log("  " + t.slice(0, 80))

  // Fetch each category to identify what it contains
  console.log("\n=== CATEGORY INSPECTION ===\n")

  for (const tokenUrl of tokenMatches) {
    const fullUrl = "https://auctions.moj.gov.jo/" + tokenUrl
    try {
      const r = await axios.get(fullUrl, {
        httpsAgent: agent,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        timeout: 15000,
      })
      const $ = cheerio.load(r.data)
      const title = $("title").text().trim()
      const h1 = $("h1, h2, .page-title, .header-title").first().text().trim()

      // Count records
      const recordCount = r.data.match(/(\d+)\s*(?:من|of|سجل|record)/i)?.[1] || "?"

      // Find category name
      const catName = r.data.match(/نوع المزاد[^<]*<[^>]*>([^<]+)/)?.[1]
        || r.data.match(/سجل عام\s+([^<\n]+)/)?.[1]
        || h1 || title

      // Count table rows (auction entries)
      const tableRows = $("table tr").length
      const gridRows = $("[id*=grd] tr, [id*=rpt], .auction-row").length

      console.log(`${catName.slice(0, 40)}`)
      console.log(`  URL: ${tokenUrl.slice(0, 60)}...`)
      console.log(`  Table rows: ${tableRows} | Grid rows: ${gridRows} | Records: ${recordCount}`)

      // Get first auction detail data
      const firstRow = $("table tr").eq(1) // skip header
      if (firstRow.length) {
        const cells = firstRow.find("td").map((_, td) => $(td).text().trim()).get()
        if (cells.length > 2) {
          console.log(`  Sample row (${cells.length} cells): ${cells.slice(0, 5).join(" | ")}`)
        }
      }

      // Find auction detail page links
      const detailLinks: string[] = []
      $("a").each((_, el) => {
        const href = $(el).attr("href") || ""
        if (href.includes("token") && href !== tokenUrl && !detailLinks.includes(href)) {
          detailLinks.push(href)
        }
      })
      console.log(`  Detail links: ${detailLinks.length}`)
      if (detailLinks[0]) console.log(`  First: ${detailLinks[0].slice(0, 80)}...`)
      console.log()
    } catch (err: any) {
      console.log(`FAILED: ${err.message}`)
    }
    await new Promise(r => setTimeout(r, 500))
  }

  // Now fetch one individual auction detail page
  console.log("\n=== INDIVIDUAL AUCTION DETAIL ===\n")
  // Try the land category first auction
  const landToken = tokenMatches.find(t => t.length > 50) // pick one
  if (landToken) {
    const listUrl = "https://auctions.moj.gov.jo/" + landToken
    const listResp = await axios.get(listUrl, {
      httpsAgent: agent,
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 15000,
    })
    const $list = cheerio.load(listResp.data)

    // Find first auction detail link
    let detailUrl = ""
    $list("a").each((_, el) => {
      const href = $list(el).attr("href") || ""
      if (href.includes("token") && href !== landToken && !detailUrl) {
        detailUrl = href
      }
    })

    if (detailUrl) {
      const fullDetail = detailUrl.startsWith("http") ? detailUrl : "https://auctions.moj.gov.jo/" + detailUrl
      console.log("Fetching detail:", fullDetail.slice(0, 80))

      const detailResp = await axios.get(fullDetail, {
        httpsAgent: agent,
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 15000,
      })
      const $d = cheerio.load(detailResp.data)

      // Extract all key-value pairs
      console.log("\nAll text fields:")
      $d("span, label, td, div").each((_, el) => {
        const text = $d(el).text().trim()
        if (text.length > 5 && text.length < 200 && (
          text.includes(":") || text.includes("القيمة") || text.includes("حوض") ||
          text.includes("قرية") || text.includes("قطعة") || text.includes("المزاد") ||
          text.includes("رقم") || text.includes("مزاد")
        )) {
          console.log("  " + text.slice(0, 120))
        }
      })
    }
  }
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1) })
