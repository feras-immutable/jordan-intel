import { scrapeEtihad } from "./scrapers/bank-al-etihad.js"
import { scrapeHousingBank } from "./scrapers/housing-bank.js"
import { scrapeMojAuctions } from "./scrapers/moj-auctions.js"

async function main() {
  console.log("=== Jordan Intel Ingestion ===")
  console.log(`Started: ${new Date().toISOString()}\n`)

  const results: Record<string, { count: number; error?: string }> = {}

  // Bank al Etihad
  try {
    const count = await scrapeEtihad()
    results.bank_al_etihad = { count }
  } catch (err: any) {
    results.bank_al_etihad = { count: 0, error: err.message }
  }

  console.log("")

  // Housing Bank
  try {
    const count = await scrapeHousingBank()
    results.housing_bank = { count }
  } catch (err: any) {
    results.housing_bank = { count: 0, error: err.message }
  }

  console.log("")

  // MOJ Auctions
  try {
    const count = await scrapeMojAuctions()
    results.moj_auctions = { count }
  } catch (err: any) {
    results.moj_auctions = { count: 0, error: err.message }
  }

  console.log("\n=== Summary ===")
  let total = 0
  for (const [bank, r] of Object.entries(results)) {
    if (r.error) {
      console.log(`  ${bank}: FAILED — ${r.error}`)
    } else {
      console.log(`  ${bank}: ${r.count} properties`)
      total += r.count
    }
  }
  console.log(`\n  Total: ${total} properties`)
  console.log(`\nDone: ${new Date().toISOString()}`)
}

main().catch(err => {
  console.error("Fatal:", err)
  process.exit(1)
})
