import { chromium } from "playwright"

async function main() {
  console.log("=== MOJ PRICE EXTRACTION ===\n")

  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    ignoreHTTPSErrors: true,
  })
  const page = await context.newPage()

  // Load homepage — may need reload to bypass CAPTCHA
  await page.goto("https://auctions.moj.gov.jo/", { waitUntil: "domcontentloaded", timeout: 30000 })
  let title = await page.title()
  if (title.includes("Validation")) {
    console.log("CAPTCHA detected — please solve it in the browser window...")
    try {
      await page.waitForFunction(() => !document.title.includes("Validation"), { timeout: 120000 })
    } catch {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 })
    }
    title = await page.title()
    // Re-navigate to homepage to get full content
    await page.goto("https://auctions.moj.gov.jo/", { waitUntil: "domcontentloaded", timeout: 30000 })
    await page.waitForTimeout(3000)
    title = await page.title()
  }
  console.log("Homepage:", title)

  const content = await page.content()
  const tokens = content.match(/AuctionsList\.aspx\?token=[^"&]+/g) || []
  console.log("Tokens:", tokens.length)
  if (tokens.length < 2) { await browser.close(); return }

  // Click the land auction link on the page instead of using the token URL directly
  console.log("\nClicking land auction link...")
  const links = await page.locator("a[href*='AuctionsList']").all()
  console.log("Auction category links:", links.length)
  for (let i = 0; i < links.length; i++) {
    const text = await links[i].textContent()
    console.log(`  ${i}: ${text?.trim().slice(0, 40)}`)
  }
  // Click the land link (usually 2nd — "أرض/ مجمع")
  const landLink = links.find(async l => (await l.textContent())?.includes("أرض")) || links[1]
  if (landLink) {
    await landLink.click()
    await page.waitForLoadState("domcontentloaded", { timeout: 30000 })
  } else {
    console.log("No land link found")
    await browser.close()
    return
  }

  // Wait for auction content to render
  await page.waitForTimeout(2000)

  // Find detail links
  const detailLinks = await page.locator("a[id*='lbtnDetails']").all()
  console.log("Detail links found:", detailLinks.length)

  // Click first detail link — the page seems to show values for ALL auctions
  const results: any[] = []

  for (let i = 0; i < Math.min(1, detailLinks.length); i++) {
    console.log(`\n--- Auction ${i + 1} ---`)

    // Re-find links since page may have changed
    const links = await page.locator("a[id*='lbtnDetails']").all()
    if (i >= links.length) break

    await links[i].click()
    // Wait for postback navigation to complete
    try {
      await page.waitForLoadState("load", { timeout: 15000 })
    } catch { /* timeout ok */ }
    await page.waitForTimeout(2000)

    // Get the full page text
    const detailContent = await page.content()
    const text = detailContent.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

    // Extract prices — MOJ format: "القيمة الابتدائية للمزاد 30000 دينار اردني القيمة التقديرية 60000"
    const opening = text.match(/القيمة الابتدائية للمزاد\s*([\d,]+)/)?.[1]
    const estimated = text.match(/القيمة التقديرية\s*([\d,]+)/)?.[1]
    const current = text.match(/القيمة الحالية للمزاد\s*([\d,]+)/)?.[1]
    const bids = text.match(/عدد المزاودات\s*:\s*(\d+)/)?.[1]

    console.log("  Opening (الابتدائية):", opening || "not found")
    console.log("  Estimated (التقديرية):", estimated || "not found")
    console.log("  Current (الحالية):", current || "not found")
    console.log("  Bids:", bids || "not found")

    // Get all value-context mentions
    const valueCtx = text.match(/(?:القيمة|المقدرة|الافتتاحي|الحالية|المبلغ|مزايد|سعر|ثمن)[^.]{0,60}/gi) || []
    console.log("  Value contexts:")
    for (const v of [...new Set(valueCtx)].slice(0, 8)) console.log("    " + v.trim().slice(0, 80))

    // All large numbers
    const nums = text.match(/\b[\d,]{4,}(?:\.\d+)?\b/g) || []
    const filtered = [...new Set(nums)].filter(n => {
      const v = parseFloat(n.replace(/,/g, ""))
      return v > 500 && v < 50000000
    })
    console.log("  Large numbers:", filtered.slice(0, 10))

    results.push({ estimated, opening, current, bids })

    // Extract ALL auction value pairs from the page
    // Pattern: "القيمة الابتدائية للمزاد X دينار اردني القيمة التقديرية Y"
    const allValues = [...text.matchAll(/القيمة الابتدائية للمزاد\s*([\d,]+)\s*دينار[^ق]*القيمة التقديرية\s*([\d,]+)/g)]
    console.log("\n  ALL opening/estimated pairs on page:", allValues.length)
    for (const m of allValues) {
      console.log(`    Opening: ${m[1]} | Estimated: ${m[2]}`)
    }

    // Extract current values
    const allCurrent = [...text.matchAll(/القيمة الحالية للمزاد\s*([\d,]+)/g)]
    console.log("  ALL current values:", allCurrent.length)
    for (const m of allCurrent) {
      console.log(`    Current: ${m[1]}`)
    }

    // Take screenshot
    await page.screenshot({ path: `moj-detail-${i + 1}.png`, fullPage: true })
    console.log("  Screenshot: moj-detail-" + (i + 1) + ".png")

    // Go back to list
    await page.goBack({ waitUntil: "domcontentloaded", timeout: 20000 })
    await page.waitForTimeout(1000)
  }

  console.log("\n=== SUMMARY ===")
  console.log("Auctions checked:", results.length)
  console.log("With estimated value:", results.filter(r => r.estimated).length)
  console.log("With opening value:", results.filter(r => r.opening).length)
  console.log("With current value:", results.filter(r => r.current).length)

  await browser.close()
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1) })
