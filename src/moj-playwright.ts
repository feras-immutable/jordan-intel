import { chromium } from "playwright"
import { getDb } from "./db.js"

async function main() {
  const db = getDb()
  console.log("=== MOJ PRICE EXTRACTION VIA PLAYWRIGHT ===\n")

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    ignoreHTTPSErrors: true,
  })
  const page = await context.newPage()

  // Navigate to MOJ homepage
  console.log("Loading MOJ homepage...")
  await page.goto("https://auctions.moj.gov.jo/", { waitUntil: "networkidle", timeout: 30000 })

  const title = await page.title()
  console.log("Title:", title)

  // Check if CAPTCHA
  if (title.includes("Validation")) {
    console.log("CAPTCHA detected — waiting for it to resolve with real browser...")
    // Playwright with a real browser engine should pass most bot checks
    // Try refreshing
    await page.reload({ waitUntil: "networkidle", timeout: 30000 })
    const title2 = await page.title()
    console.log("After reload:", title2)

    if (title2.includes("Validation")) {
      // Take screenshot of captcha
      await page.screenshot({ path: "captcha.png" })
      console.log("CAPTCHA still present. Screenshot saved to captcha.png")
      console.log("You need to solve it manually or use a non-headless browser.")

      // Try with headed browser so user can solve captcha
      await browser.close()

      console.log("\nLaunching headed browser for manual CAPTCHA solve...")
      const browser2 = await chromium.launch({ headless: false })
      const ctx2 = await browser2.newContext({ ignoreHTTPSErrors: true })
      const page2 = await ctx2.newPage()
      await page2.goto("https://auctions.moj.gov.jo/", { timeout: 30000 })

      console.log("Please solve the CAPTCHA in the browser window...")
      console.log("Waiting up to 60 seconds...")

      // Wait for the homepage to load (title changes after captcha)
      try {
        await page2.waitForFunction(() => !document.title.includes("Validation"), { timeout: 60000 })
        console.log("CAPTCHA solved! Continuing...")
      } catch {
        console.log("Timeout waiting for CAPTCHA. Exiting.")
        await browser2.close()
        return
      }

      // Now we're past the CAPTCHA — find auction links
      const content = await page2.content()
      const tokens = content.match(/AuctionsList\.aspx\?token=[^"&]+/g) || []
      console.log("Tokens found:", tokens.length)

      if (tokens.length < 2) {
        await browser2.close()
        return
      }

      // Navigate to land auctions
      const landUrl = "https://auctions.moj.gov.jo/" + tokens[1]
      console.log("\nNavigating to land auctions...")
      await page2.goto(landUrl, { waitUntil: "networkidle", timeout: 30000 })

      // Get first auction's detail — click on "المواصفات" or detail link
      const auctionCards = await page2.locator("[onclick*='SetCurrentAuctionID']").all()
      console.log("Auction clickable elements:", auctionCards.length)

      // Try clicking the first "details" link
      const detailLinks = await page2.locator("a:has-text('التفاصيل'), a:has-text('المزيد'), a[id*='lbtnDetails']").all()
      console.log("Detail links:", detailLinks.length)

      if (detailLinks.length > 0) {
        console.log("\nClicking first detail link...")
        await detailLinks[0].click()
        await page2.waitForTimeout(3000)

        // Now extract price data from the expanded view
        const detailContent = await page2.content()
        const detailText = detailContent.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

        // Look for price patterns
        const patterns = [
          { name: "القيمة المقدرة", regex: /القيمة المقدرة[:\s]*([\d,]+(?:\.\d+)?)/i },
          { name: "القيمة الافتتاحية", regex: /(?:القيمة الافتتاحية|الابتدائي)[:\s]*([\d,]+(?:\.\d+)?)/i },
          { name: "القيمة الحالية", regex: /القيمة الحالية[:\s]*([\d,]+(?:\.\d+)?)/i },
          { name: "قيمة المزايدة", regex: /قيمة المزايدة[:\s]*([\d,]+(?:\.\d+)?)/i },
          { name: "آخر مزايدة", regex: /آخر مزايدة[:\s]*([\d,]+(?:\.\d+)?)/i },
        ]

        console.log("\n=== PRICE DATA FOUND ===")
        for (const p of patterns) {
          const match = detailText.match(p.regex)
          if (match) console.log(`  ${p.name}: ${match[1]}`)
        }

        // Also look for all large numbers
        const nums = detailText.match(/\b[\d,]{4,}\b/g) || []
        const uniqueNums = [...new Set(nums)].filter(n => {
          const v = parseInt(n.replace(/,/g, ""))
          return v > 1000 && v < 100000000
        })
        console.log("\nLarge numbers found:", uniqueNums.slice(0, 15))

        // Find all value-context text
        const valueText = detailText.match(/(?:القيمة|المقدرة|الافتتاحي|الحالية|المبلغ|مزايد|عدد)[^.]{0,80}/gi) || []
        console.log("\nValue context:")
        for (const v of [...new Set(valueText)].slice(0, 10)) console.log("  " + v.trim().slice(0, 100))

        // Take screenshot of the detail view
        await page2.screenshot({ path: "moj-detail.png", fullPage: true })
        console.log("\nScreenshot saved: moj-detail.png")
      }

      await browser2.close()
      return
    }
  }

  // If we got here without CAPTCHA, continue normally
  const content = await page.content()
  const tokens = content.match(/AuctionsList\.aspx\?token=[^"&]+/g) || []
  console.log("Tokens:", tokens.length)

  await browser.close()
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1) })
