import { scrapeMojAuctions } from "./scrapers/moj-auctions.js"

async function main() {
  console.log("=== MOJ Auction Ingestion ===\n")
  const count = await scrapeMojAuctions()
  console.log(`\nTotal: ${count} auctions`)
}

main().catch(err => { console.error("Fatal:", err); process.exit(1) })
