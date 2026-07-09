import Database from "better-sqlite3"
import axios from "axios"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const db = new Database(join(dirname(fileURLToPath(import.meta.url)), "..", "jordan-intel.db"))

async function main() {
  const parcels = db.prepare(
    "SELECT id, canonical_key, aradi_url, village_id, basin_id, parcel_number FROM parcels WHERE aradi_url IS NOT NULL"
  ).all() as Array<{ id: number; canonical_key: string; aradi_url: string; village_id: number; basin_id: number; parcel_number: number }>

  console.log(`Testing ${parcels.length} aradi.io links...\n`)

  let working = 0
  let broken = 0
  let errors: Array<{ key: string; url: string; status: number | string }> = []

  // Test in batches to be polite
  for (let i = 0; i < parcels.length; i++) {
    const p = parcels[i]
    try {
      const resp = await axios.get(p.aradi_url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        timeout: 10000,
        validateStatus: () => true, // don't throw on 500
      })

      if (resp.status === 200 && !resp.data.includes("Internal Server Error")) {
        working++
      } else {
        broken++
        errors.push({ key: p.canonical_key, url: p.aradi_url, status: resp.status })
      }
    } catch (err: any) {
      broken++
      errors.push({ key: p.canonical_key, url: p.aradi_url, status: err.message })
    }

    if ((i + 1) % 50 === 0) console.log(`  Checked ${i + 1}/${parcels.length}...`)

    // Rate limit — 200ms between requests
    await new Promise(r => setTimeout(r, 200))
  }

  console.log(`\n=== ARADI.IO VALIDATION ===`)
  console.log(`Total tested: ${parcels.length}`)
  console.log(`Working: ${working} (${Math.round(working / parcels.length * 100)}%)`)
  console.log(`Broken: ${broken} (${Math.round(broken / parcels.length * 100)}%)`)

  if (errors.length > 0) {
    console.log(`\nBroken links (first 20):`)
    for (const e of errors.slice(0, 20)) {
      console.log(`  ${e.key} — ${e.url} — ${e.status}`)
    }
  }

  // Update parcels table — mark broken ones
  const markBroken = db.prepare("UPDATE parcels SET resolution_status = 'unverified', resolution_confidence = 0.3 WHERE canonical_key = ?")
  for (const e of errors) {
    markBroken.run(e.key)
  }
  console.log(`\nMarked ${errors.length} parcels as 'unverified' in database`)
}

main().catch(err => { console.error("Fatal:", err); process.exit(1) })
