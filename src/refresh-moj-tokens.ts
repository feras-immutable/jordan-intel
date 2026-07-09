import axios from "axios"
import https from "https"

const agent = new https.Agent({ rejectUnauthorized: false })

async function main() {
  const r = await axios.get("https://auctions.moj.gov.jo/", {
    httpsAgent: agent,
    headers: { "User-Agent": "Mozilla/5.0" },
    timeout: 15000,
  })
  const tokens = r.data.match(/AuctionsList\.aspx\?token=[^"&]+/g) || []
  console.log("Fresh tokens:")
  for (const t of tokens) console.log("  " + t)

  // Identify which is which by fetching each and checking the category text
  for (const t of tokens) {
    try {
      const resp = await axios.get("https://auctions.moj.gov.jo/" + t, {
        httpsAgent: agent,
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 15000,
      })
      const catMatch = resp.data.match(/سجل عام\s+([^<\n]+?)(?:\s*-|\s*\d)/)?.[1]
        || resp.data.match(/(أرض|شقة|مركبة|أُخرى|شركة)/)?.[1]
      const count = (resp.data.match(/رقم المزاد\s*:/g) || []).length
      console.log(`  → ${catMatch || "?"} (${count} on page 1)`)
    } catch { /* skip */ }
    await new Promise(r => setTimeout(r, 500))
  }
}

main().catch(err => console.error(err.message))
