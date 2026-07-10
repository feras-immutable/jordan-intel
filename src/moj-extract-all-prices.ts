import { chromium } from "playwright"
import { getDb } from "./db.js"

async function main() {
  const db = getDb()
  console.log("=== MOJ FULL PRICE EXTRACTION ===\n")

  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    ignoreHTTPSErrors: true,
  })
  const page = await context.newPage()

  // Load homepage
  await page.goto("https://auctions.moj.gov.jo/", { waitUntil: "domcontentloaded", timeout: 30000 })
  let title = await page.title()

  if (title.includes("Validation")) {
    console.log("CAPTCHA — please solve it in the browser...")
    try {
      await page.waitForFunction(() => !document.title.includes("Validation"), { timeout: 120000 })
    } catch { /* */ }
    await page.goto("https://auctions.moj.gov.jo/", { waitUntil: "domcontentloaded", timeout: 30000 })
    await page.waitForTimeout(3000)
    title = await page.title()
  }
  console.log("Homepage:", title)

  const homeContent = await page.content()
  const tokens = homeContent.match(/AuctionsList\.aspx\?token=[^"&]+/g) || []
  console.log("Tokens:", tokens.length)
  if (tokens.length < 2) { await browser.close(); return }

  // Categories to process — land (index 1) and apartments (index 2)
  const categories = [
    { name: "land", index: 1 },
    { name: "apartment", index: 2 },
  ]

  // Map auction case numbers to prices
  const priceMap = new Map<string, { opening: number; estimated: number; current: number }>()

  for (const cat of categories) {
    console.log(`\n=== Processing ${cat.name} auctions ===`)

    // Navigate to category from homepage
    await page.goto("https://auctions.moj.gov.jo/", { waitUntil: "domcontentloaded", timeout: 30000 })
    await page.waitForTimeout(2000)

    const catLinks = await page.locator("a[href*='AuctionsList']").all()
    if (cat.index >= catLinks.length) { console.log("Category link not found"); continue }

    await catLinks[cat.index].click()
    await page.waitForTimeout(5000)

    let pageNum = 0
    const maxPages = 30

    while (pageNum < maxPages) {
      pageNum++
      console.log(`\n--- Page ${pageNum} ---`)

      // Extract data by clicking each detail link one by one, then going back
      // First, count auctions on this page
      const auctionCount = await page.locator("a[id*='lbtnDetails']").count()
      console.log(`Auctions on page: ${auctionCount}`)
      if (auctionCount === 0) break

      // Click the first detail to get the expanded view with prices
      const firstDetail = page.locator("a[id*='lbtnDetails']").first()
      await firstDetail.scrollIntoViewIfNeeded()
      await firstDetail.click({ timeout: 10000 })
      try { await page.waitForLoadState("load", { timeout: 15000 }) } catch { /* */ }
      await page.waitForTimeout(3000)

      // Extract page text
      const text = (await page.content()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

      // Extract auction case numbers from this page
      const caseNumbers = [...text.matchAll(/رقم المزاد\s*:([^أ]+?)أرض|رقم المزاد\s*:([^ش]+?)شقة/g)]
        .map(m => (m[1] || m[2] || "").trim())
        .filter(Boolean)

      // Also try to get case numbers from the raw HTML
      const htmlContent = await page.content()
      const caseFromHtml = [...htmlContent.matchAll(/رقم المزاد\s*:([^<]+)/g)]
        .map(m => m[1].replace(/<[^>]+>/g, "").trim().split(/\s/)[0])
        .filter(s => s.match(/^\d+-\d+-/))

      const cases = caseFromHtml.length > 0 ? caseFromHtml : caseNumbers
      console.log(`Case numbers found: ${cases.length}`)

      // Extract all price pairs
      const openingEstimated = [...text.matchAll(/القيمة الابتدائية للمزاد\s*([\d,]+)\s*دينار[^ق]*?القيمة التقديرية\s*([\d,]+)/g)]
      const currentValues = [...text.matchAll(/القيمة الحالية للمزاد\s*([\d,]+)/g)]

      console.log(`Price pairs: ${openingEstimated.length} | Current values: ${currentValues.length}`)

      // Match prices to cases (they appear in order)
      for (let i = 0; i < cases.length && i < openingEstimated.length; i++) {
        const caseNum = cases[i]
        const opening = parseInt(openingEstimated[i][1].replace(/,/g, ""))
        const estimated = parseInt(openingEstimated[i][2].replace(/,/g, ""))
        const current = i < currentValues.length ? parseInt(currentValues[i][1].replace(/,/g, "")) : 0

        priceMap.set(caseNum, { opening, estimated, current })
        console.log(`  ${caseNum}: opening=${opening} estimated=${estimated} current=${current}`)
      }

      // If we got fewer cases than prices, log the orphan prices
      if (openingEstimated.length > cases.length) {
        console.log(`  ${openingEstimated.length - cases.length} orphan price pairs (no matching case)`)
      }

      // Go back to list view before pagination
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 })
      await page.waitForTimeout(3000)

      // Navigate to next page
      let foundNext = false
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.waitForTimeout(1000)

      const nextPageLinks = await page.locator("a[href*='rptPaging']").all()
      for (const link of nextPageLinks) {
        const linkText = (await link.textContent())?.trim()
        if (linkText === String(pageNum + 1)) {
          await link.scrollIntoViewIfNeeded()
          await page.waitForTimeout(500)
          await link.click({ timeout: 10000 })
          await page.waitForTimeout(5000)
          foundNext = true
          break
        }
      }

      if (!foundNext) {
        for (const link of nextPageLinks) {
          const linkText = (await link.textContent())?.trim()
          if (linkText === "..." || linkText === "»") {
            await link.scrollIntoViewIfNeeded()
            await page.waitForTimeout(500)
            await link.click({ timeout: 10000 })
            await page.waitForTimeout(5000)
            foundNext = true
            break
          }
        }
      }

      if (!foundNext) {
        console.log("No more pages")
        break
      }
    }
  }

  await browser.close()

  // Update database with extracted prices
  console.log(`\n\n=== UPDATING DATABASE ===`)
  console.log(`Total prices extracted: ${priceMap.size}`)

  const updateObs = db.prepare(`
    UPDATE observations SET price = ?
    WHERE source_record_id = (
      SELECT sr.id FROM source_records sr
      WHERE sr.institution_id = 'moj_auctions' AND sr.source_property_id LIKE ?
      LIMIT 1
    )
    AND id = (
      SELECT MAX(o2.id) FROM observations o2
      WHERE o2.source_record_id = (
        SELECT sr2.id FROM source_records sr2
        WHERE sr2.institution_id = 'moj_auctions' AND sr2.source_property_id LIKE ?
        LIMIT 1
      )
    )
  `)

  let updated = 0, notFound = 0
  for (const [caseNum, prices] of priceMap) {
    // Use estimated value as the main price (most meaningful for comparison)
    const price = prices.estimated || prices.opening
    if (!price) continue

    // Match case number to source_property_id (which starts with the case number)
    const pattern = caseNum + "%"
    try {
      const result = updateObs.run(price, pattern, pattern)
      if (result.changes > 0) {
        updated++
      } else {
        notFound++
      }
    } catch {
      notFound++
    }
  }

  console.log(`Updated: ${updated}`)
  console.log(`Not matched: ${notFound}`)

  // Verify
  const withPrice = db.prepare(`
    SELECT COUNT(*) as c FROM observations o
    JOIN source_records sr ON sr.id = o.source_record_id
    WHERE sr.institution_id = 'moj_auctions' AND o.price IS NOT NULL AND o.price > 0
    AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
  `).get() as any
  console.log(`\nMOJ auctions with prices: ${withPrice.c}`)
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1) })
