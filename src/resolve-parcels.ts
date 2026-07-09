import Database from "better-sqlite3"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const db = new Database(join(__dirname, "..", "jordan-intel.db"))

// Ensure schema is up to date
import { getDb } from "./db.js"
getDb() // triggers schema creation including parcels table

function extractVillageId(village: string | null): number | null {
  if (!village) return null
  const match = village.match(/\((\d+)\)/)
  return match ? parseInt(match[1]) : null
}

function extractBasinId(basin: string | null): number | null {
  if (!basin) return null
  // Housing Bank: "Awais (1)" or "Al-Buhayrah (43)"
  const parenMatch = basin.match(/\((\d+)\)/)
  if (parenMatch) return parseInt(parenMatch[1])
  // Etihad: "Al-Mas'ada - 3" or "Al-Wadi - 1"
  const dashMatch = basin.match(/- (\d+)$/)
  if (dashMatch) return parseInt(dashMatch[1])
  // Just a number
  const numMatch = basin.match(/^(\d+)$/)
  if (numMatch) return parseInt(numMatch[1])
  return null
}

function extractParcelNumber(parcel: string | null): number | null {
  if (!parcel) return null
  // Clean: strip description text that leaked in
  const cleaned = parcel.replace(/\s*Description:.*$/i, "").trim()
  // For "123/456" format (unit/plot), use the plot number (second number is the land parcel)
  // Actually, "123/456" means unit 123 on plot 456 in some cases, or plot 123 subdivided...
  // For now, take the first number as the primary parcel reference
  const match = cleaned.match(/^(\d+)/)
  return match ? parseInt(match[1]) : null
}

function extractVillageName(village: string | null): string | null {
  if (!village) return null
  return village.replace(/\s*\(\d+\)\s*$/, "").trim() || null
}

function extractBasinName(basin: string | null): string | null {
  if (!basin) return null
  return basin.replace(/\s*\(\d+\)\s*$/, "").replace(/\s*-\s*\d+\s*$/, "").trim() || null
}

function determineAssetLevel(propertyType: string | null, title: string | null): string {
  const type = (propertyType || "").toLowerCase()
  const t = (title || "").toLowerCase()
  if (type === "land" || t.includes("land plot") || t.includes("plot of land") || t.includes("قطعة أرض")) return "parcel"
  if (type === "building" || t.includes("building") || t.includes("house") || t.includes("villa") || t.includes("عمارة")) return "building"
  if (type === "unit" || type === "apartment" || t.includes("apartment") || t.includes("شقة") || t.includes("warehouse") || t.includes("office")) return "unit"
  return "unknown"
}

function main() {
  console.log("=== PARCEL RESOLUTION ===\n")

  // Get all active source records with their latest observation
  const records = db.prepare(`
    SELECT sr.id as source_record_id, sr.institution_id, sr.source_property_id,
      o.village, o.basin, o.parcel_number, o.property_type, o.title,
      o.latitude, o.longitude
    FROM source_records sr
    JOIN observations o ON o.source_record_id = sr.id
    WHERE sr.currently_active = 1
    AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
  `).all() as any[]

  const upsertParcel = db.prepare(`
    INSERT INTO parcels (canonical_key, village_id, basin_id, parcel_number, village_name, basin_name,
      resolution_status, resolution_method, resolution_confidence, aradi_url, latitude, longitude)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(canonical_key) DO UPDATE SET
      village_name = COALESCE(excluded.village_name, parcels.village_name),
      basin_name = COALESCE(excluded.basin_name, parcels.basin_name),
      aradi_url = COALESCE(excluded.aradi_url, parcels.aradi_url),
      latitude = COALESCE(excluded.latitude, parcels.latitude),
      longitude = COALESCE(excluded.longitude, parcels.longitude),
      updated_at = datetime('now')
  `)

  const getParcel = db.prepare(`SELECT id FROM parcels WHERE canonical_key = ?`)

  const linkToParcel = db.prepare(`
    INSERT INTO source_record_parcels (source_record_id, parcel_id, asset_level, confidence)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(source_record_id, parcel_id) DO UPDATE SET
      asset_level = excluded.asset_level,
      confidence = excluded.confidence
  `)

  let resolved = 0
  let partial = 0
  let unresolved = 0

  for (const r of records) {
    const villageId = extractVillageId(r.village)
    const basinId = extractBasinId(r.basin)
    const parcelNum = extractParcelNumber(r.parcel_number)
    const villageName = extractVillageName(r.village)
    const basinName = extractBasinName(r.basin)
    const assetLevel = determineAssetLevel(r.property_type, r.title)

    if (villageId && basinId && parcelNum) {
      // Full resolution
      const key = `JOR:${villageId}:${basinId}:${parcelNum}`
      const aradiUrl = `https://aradi.io/plot/${villageId}/${basinId}/${parcelNum}`

      upsertParcel.run(
        key, villageId, basinId, parcelNum,
        villageName, basinName,
        "resolved", "auto_village_basin_parcel", 1.0,
        aradiUrl, r.latitude, r.longitude
      )

      const parcel = getParcel.get(key) as { id: number }
      linkToParcel.run(r.source_record_id, parcel.id, assetLevel, 1.0)
      resolved++

    } else if (basinId && parcelNum) {
      // Partial — have basin + parcel but no village (typical for Etihad)
      const key = `JOR:?:${basinId}:${parcelNum}`

      upsertParcel.run(
        key, null, basinId, parcelNum,
        villageName, basinName,
        "partial", "auto_basin_parcel_only", 0.5,
        null, r.latitude, r.longitude
      )

      const parcel = getParcel.get(key) as { id: number }
      linkToParcel.run(r.source_record_id, parcel.id, assetLevel, 0.5)
      partial++

    } else {
      unresolved++
    }
  }

  // Stats
  const parcelCount = (db.prepare("SELECT COUNT(*) as c FROM parcels").get() as any).c
  const resolvedParcels = (db.prepare("SELECT COUNT(*) as c FROM parcels WHERE resolution_status = 'resolved'").get() as any).c
  const partialParcels = (db.prepare("SELECT COUNT(*) as c FROM parcels WHERE resolution_status = 'partial'").get() as any).c
  const linkedRecords = (db.prepare("SELECT COUNT(*) as c FROM source_record_parcels").get() as any).c

  // Asset level breakdown
  const assetLevels = db.prepare(`
    SELECT asset_level, COUNT(*) as c FROM source_record_parcels GROUP BY asset_level ORDER BY c DESC
  `).all() as Array<{ asset_level: string; c: number }>

  console.log("RESOLUTION RESULTS")
  console.log("─".repeat(50))
  console.log(`  Source records processed: ${records.length}`)
  console.log(`  Fully resolved: ${resolved} (${Math.round(resolved / records.length * 100)}%)`)
  console.log(`  Partial (no village): ${partial} (${Math.round(partial / records.length * 100)}%)`)
  console.log(`  Unresolved: ${unresolved}`)

  console.log(`\nPARCEL DATABASE`)
  console.log("─".repeat(50))
  console.log(`  Total unique parcels: ${parcelCount}`)
  console.log(`  Fully resolved: ${resolvedParcels}`)
  console.log(`  Partial: ${partialParcels}`)
  console.log(`  Linked source records: ${linkedRecords}`)

  console.log(`\nASSET LEVELS`)
  console.log("─".repeat(50))
  for (const a of assetLevels) {
    console.log(`  ${a.asset_level.padEnd(15)} ${a.c}`)
  }

  // Check for parcels with multiple listings (potential same-asset detection)
  const multiListingParcels = db.prepare(`
    SELECT p.canonical_key, COUNT(*) as listing_count
    FROM source_record_parcels srp
    JOIN parcels p ON p.id = srp.parcel_id
    GROUP BY srp.parcel_id
    HAVING COUNT(*) > 1
    ORDER BY listing_count DESC
    LIMIT 10
  `).all() as Array<{ canonical_key: string; listing_count: number }>

  if (multiListingParcels.length > 0) {
    console.log(`\nPARCELS WITH MULTIPLE LISTINGS`)
    console.log("─".repeat(50))
    for (const p of multiListingParcels) {
      console.log(`  ${p.canonical_key}: ${p.listing_count} listings`)
    }
  }

  console.log("\nDone.")
}

main()
