import axios from "axios"
import * as cheerio from "cheerio"

async function tryUrl(url: string) {
  try {
    const resp = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: () => true,
    })
    const $ = cheerio.load(resp.data)
    const postLinks = $("a[href*='/post/']").length
    const title = $("title").text().trim().slice(0, 80)
    const itemCount = resp.data.match(/numberOfItems['":\s]+(\d+)/)?.[1] || "?"
    console.log(`${resp.status} | ${url}`)
    console.log(`  Title: ${title}`)
    console.log(`  Post links: ${postLinks} | Items: ${itemCount}`)
    if (postLinks > 0) {
      const firstPost = $("a[href*='/post/']").first().attr("href")
      console.log(`  Sample link: ${firstPost}`)
    }
  } catch (err: any) {
    console.log(`ERR | ${url}`)
    console.log(`  ${err.message}`)
  }
}

async function main() {
  const urls = [
    "https://jo.opensooq.com/ar/عقارات-للبيع/اراضي-للبيع/عمان",
    "https://jo.opensooq.com/ar/find?scID=55&cID=31",
    "https://jo.opensooq.com/en/find?scID=55&cID=31",
    "https://jo.opensooq.com/ar/real-estate-for-sale/lands-for-sale",
    "https://jo.opensooq.com/en/real-estate/lands-for-sale",
    "https://jo.opensooq.com/en/properties-for-sale/land-for-sale",
  ]

  for (const url of urls) {
    await tryUrl(url)
    console.log()
    await new Promise(r => setTimeout(r, 500))
  }

  // Also try fetching a known OpenSooq land listing directly
  console.log("=== TESTING INDIVIDUAL LISTING ===")
  const searchResp = await axios.get("https://jo.opensooq.com/en/search?term=land+amman+basin", {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    timeout: 10000,
    validateStatus: () => true,
  })
  console.log(`Search page status: ${searchResp.status}, length: ${searchResp.data.length}`)
  const $s = cheerio.load(searchResp.data)
  const searchLinks = $s("a[href*='/post/']").length
  console.log(`Post links from search: ${searchLinks}`)
  if (searchLinks > 0) {
    const firstLink = $s("a[href*='/post/']").first().attr("href")
    console.log(`First: ${firstLink}`)
  }
}

main().catch(err => console.error("Fatal:", err.message))
