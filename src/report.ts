import { getDb } from "./db.js"

function main() {
  const db = getDb()

  console.log("=== Jordan Intel Report ===\n")

  // Total properties by institution
  const byInstitution = db.prepare(`
    SELECT i.name_en, COUNT(*) as total,
      SUM(CASE WHEN sr.currently_active = 1 THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN sr.currently_active = 0 THEN 1 ELSE 0 END) as inactive
    FROM source_records sr
    JOIN institutions i ON i.id = sr.institution_id
    GROUP BY sr.institution_id
    ORDER BY total DESC
  `).all() as Array<{ name_en: string; total: number; active: number; inactive: number }>

  console.log("INVENTORY BY BANK")
  console.log("─".repeat(60))
  let totalAll = 0
  for (const row of byInstitution) {
    console.log(`  ${row.name_en.padEnd(25)} ${String(row.active).padStart(5)} active  ${String(row.inactive).padStart(5)} removed  ${String(row.total).padStart(5)} total`)
    totalAll += row.total
  }
  console.log("─".repeat(60))
  console.log(`  ${"TOTAL".padEnd(25)} ${String(totalAll).padStart(5)}`)

  // Property types
  console.log("\n\nPROPERTY TYPES")
  console.log("─".repeat(40))
  const byType = db.prepare(`
    SELECT o.property_type, COUNT(DISTINCT o.source_record_id) as count
    FROM observations o
    JOIN source_records sr ON sr.id = o.source_record_id
    WHERE sr.currently_active = 1
    GROUP BY o.property_type
    ORDER BY count DESC
  `).all() as Array<{ property_type: string | null; count: number }>

  for (const row of byType) {
    console.log(`  ${(row.property_type || "unknown").padEnd(20)} ${row.count}`)
  }

  // Recent change events
  console.log("\n\nRECENT EVENTS (last 7 days)")
  console.log("─".repeat(80))
  const events = db.prepare(`
    SELECT ce.event_type, ce.detected_at, ce.detail, i.name_en,
      sr.source_property_id, sr.source_url
    FROM change_events ce
    JOIN source_records sr ON sr.id = ce.source_record_id
    JOIN institutions i ON i.id = sr.institution_id
    WHERE ce.detected_at >= datetime('now', '-7 days')
    ORDER BY ce.detected_at DESC
    LIMIT 50
  `).all() as Array<{
    event_type: string; detected_at: string; detail: string;
    name_en: string; source_property_id: string; source_url: string
  }>

  if (events.length === 0) {
    console.log("  No events yet. Run ingestion twice to start detecting changes.")
  }

  const eventCounts: Record<string, number> = {}
  for (const e of events) {
    eventCounts[e.event_type] = (eventCounts[e.event_type] || 0) + 1
  }

  if (Object.keys(eventCounts).length > 0) {
    console.log("\n  Summary:")
    for (const [type, count] of Object.entries(eventCounts).sort((a, b) => b[1] - a[1])) {
      const emoji = type === "NEW" ? "🟢" : type === "PRICE_REDUCED" ? "🔴" : type === "PRICE_INCREASED" ? "🔵" : type === "REMOVED" ? "⚫" : "🟡"
      console.log(`    ${emoji} ${type.padEnd(20)} ${count}`)
    }

    console.log("\n  Details:")
    for (const e of events.slice(0, 20)) {
      const emoji = e.event_type === "NEW" ? "🟢" : e.event_type === "PRICE_REDUCED" ? "🔴" : e.event_type === "REMOVED" ? "⚫" : "🟡"
      console.log(`    ${emoji} [${e.name_en}] ${e.source_property_id}: ${e.detail || e.event_type}`)
    }
    if (events.length > 20) console.log(`    ... and ${events.length - 20} more`)
  }

  // Price stats for active properties
  console.log("\n\nPRICE DISTRIBUTION (active properties with price)")
  console.log("─".repeat(60))
  const priceStats = db.prepare(`
    SELECT
      MIN(o.price) as min_price,
      MAX(o.price) as max_price,
      AVG(o.price) as avg_price,
      COUNT(*) as count
    FROM observations o
    JOIN source_records sr ON sr.id = o.source_record_id
    WHERE sr.currently_active = 1 AND o.price > 0
    AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = o.source_record_id)
  `).get() as { min_price: number; max_price: number; avg_price: number; count: number }

  if (priceStats.count > 0) {
    console.log(`  Properties with price: ${priceStats.count}`)
    console.log(`  Min: ${Math.round(priceStats.min_price).toLocaleString()} JOD`)
    console.log(`  Max: ${Math.round(priceStats.max_price).toLocaleString()} JOD`)
    console.log(`  Avg: ${Math.round(priceStats.avg_price).toLocaleString()} JOD`)
  }

  // Parcel data completeness
  console.log("\n\nPARCEL IDENTITY COMPLETENESS")
  console.log("─".repeat(60))
  const parcelStats = db.prepare(`
    SELECT
      COUNT(DISTINCT o.source_record_id) as total,
      SUM(CASE WHEN o.village IS NOT NULL OR o.basin IS NOT NULL THEN 1 ELSE 0 END) as has_village_or_basin,
      SUM(CASE WHEN o.parcel_number IS NOT NULL THEN 1 ELSE 0 END) as has_parcel,
      SUM(CASE WHEN o.zoning IS NOT NULL THEN 1 ELSE 0 END) as has_zoning,
      SUM(CASE WHEN o.latitude IS NOT NULL THEN 1 ELSE 0 END) as has_coords
    FROM observations o
    JOIN source_records sr ON sr.id = o.source_record_id
    WHERE sr.currently_active = 1
    AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = o.source_record_id)
  `).get() as any

  console.log(`  Total active: ${parcelStats.total}`)
  console.log(`  Has village/basin: ${parcelStats.has_village_or_basin} (${Math.round(parcelStats.has_village_or_basin / parcelStats.total * 100)}%)`)
  console.log(`  Has parcel number: ${parcelStats.has_parcel} (${Math.round(parcelStats.has_parcel / parcelStats.total * 100)}%)`)
  console.log(`  Has zoning: ${parcelStats.has_zoning} (${Math.round(parcelStats.has_zoning / parcelStats.total * 100)}%)`)
  console.log(`  Has coordinates: ${parcelStats.has_coords} (${Math.round(parcelStats.has_coords / parcelStats.total * 100)}%)`)

  // Ingestion history
  console.log("\n\nINGESTION HISTORY")
  console.log("─".repeat(80))
  const runs = db.prepare(`
    SELECT ir.*, i.name_en FROM ingestion_runs ir
    JOIN institutions i ON i.id = ir.institution_id
    ORDER BY ir.started_at DESC LIMIT 10
  `).all() as Array<any>

  for (const r of runs) {
    const status = r.status === "completed" ? "✅" : r.status === "failed" ? "❌" : "⏳"
    console.log(`  ${status} ${r.name_en} | ${r.started_at} | ${r.records_found} found, ${r.records_new} new, ${r.records_changed} changed, ${r.records_removed} removed`)
    if (r.error) console.log(`     Error: ${r.error}`)
  }

  console.log("")
}

main()
