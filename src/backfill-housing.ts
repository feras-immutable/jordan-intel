import axios from "axios"
import * as cheerio from "cheerio"
import { getDb } from "./db.js"

async function main() {
  const db = getDb()
  console.log("=== BACKFILLING HOUSING BANK FROM WAYBACK ===\n")

  // May 2026 snapshot
  const snapDate = "2026-05-11"
  const url = "https://web.archive.org/web/20260511192034/https://hbtf.com/ar/new-realestate"

  console.log("Fetching:", url)
  const resp = await axios.get(url, { timeout: 30000 })
  const $ = cheerio.load(resp.data)

  // Find property links
  const propertyUrls: string[] = []
  $("a[href*='new-realestate/']").each((_, el) => {
    const href = $(el).attr("href") || ""
    if (href.includes("AQ-") && !href.includes("filter") && !href.includes("category")) {
      const ref = href.match(/(AQ-[A-Z]+-\d+)/)?.[1]
      if (ref && !propertyUrls.includes(ref)) propertyUrls.push(ref)
    }
  })

  console.log(`Found ${propertyUrls.length} property references in May 2026 snapshot`)

  // Check which of these are still in our current database
  let stillActive = 0, gone = 0

  for (const ref of propertyUrls) {
    const exists = db.prepare("SELECT id, currently_active FROM source_records WHERE institution_id = 'housing_bank' AND source_property_id = ?")
      .get(ref) as any
    if (exists) {
      stillActive++
      // Update first_seen_at if this is earlier
      db.prepare("UPDATE source_records SET first_seen_at = MIN(first_seen_at, ?) WHERE id = ? AND first_seen_at > ?")
        .run(snapDate + "T00:00:00Z", exists.id, snapDate + "T00:00:00Z")
    } else {
      gone++
    }
  }

  console.log(`\nStill in current inventory: ${stillActive}`)
  console.log(`No longer listed: ${gone}`)

  if (gone > 0) {
    console.log("\nProperties from May 2026 that are NO LONGER listed (possible sales):")
    for (const ref of propertyUrls) {
      const exists = db.prepare("SELECT id FROM source_records WHERE institution_id = 'housing_bank' AND source_property_id = ?").get(ref)
      if (!exists) console.log("  " + ref)
    }
  }

  // Check how many current properties were also in the May snapshot
  const currentCount = (db.prepare("SELECT COUNT(*) as c FROM source_records WHERE institution_id = 'housing_bank' AND currently_active = 1").get() as any).c
  console.log(`\nCurrent Housing Bank inventory: ${currentCount}`)
  console.log(`Were already listed in May 2026: ${stillActive} (${Math.round(stillActive / currentCount * 100)}%)`)
  console.log(`Added since May 2026: ${currentCount - stillActive}`)
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1) })
