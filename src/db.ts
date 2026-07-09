import Database from "better-sqlite3"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const DB_PATH = join(__dirname, "..", "jordan-intel.db")

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db
  db = new Database(DB_PATH)
  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")
  ensureSchema()
  return db
}

function ensureSchema() {
  const d = db!

  // Institutions (banks, auction houses, etc.)
  d.exec(`
    CREATE TABLE IF NOT EXISTS institutions (
      id TEXT PRIMARY KEY,
      name_ar TEXT,
      name_en TEXT NOT NULL,
      website TEXT,
      source_type TEXT NOT NULL DEFAULT 'bank',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // Ingestion runs — one row per scrape execution
  d.exec(`
    CREATE TABLE IF NOT EXISTS ingestion_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      institution_id TEXT NOT NULL REFERENCES institutions(id),
      started_at TEXT NOT NULL,
      completed_at TEXT,
      records_found INTEGER DEFAULT 0,
      records_new INTEGER DEFAULT 0,
      records_changed INTEGER DEFAULT 0,
      records_removed INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'running',
      error TEXT,
      parser_version TEXT
    )
  `)

  // Source records — what exactly did the bank show us?
  // One row per unique property listing from a source. Never deleted.
  d.exec(`
    CREATE TABLE IF NOT EXISTS source_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      institution_id TEXT NOT NULL REFERENCES institutions(id),
      source_property_id TEXT NOT NULL,
      source_url TEXT,
      raw_data TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      currently_active INTEGER NOT NULL DEFAULT 1,
      consecutive_misses INTEGER NOT NULL DEFAULT 0,
      UNIQUE(institution_id, source_property_id)
    )
  `)

  // Observations — immutable snapshots. Every time we see a property, record what it looks like.
  // Content hash lets us detect changes without comparing every field.
  d.exec(`
    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_record_id INTEGER NOT NULL REFERENCES source_records(id),
      ingestion_run_id INTEGER REFERENCES ingestion_runs(id),
      observed_at TEXT NOT NULL,
      price REAL,
      price_currency TEXT DEFAULT 'JOD',
      area_sqm REAL,
      land_area_sqm REAL,
      property_type TEXT,
      title TEXT,
      description TEXT,
      governorate TEXT,
      city TEXT,
      neighborhood TEXT,
      village TEXT,
      basin TEXT,
      parcel_number TEXT,
      zoning TEXT,
      latitude REAL,
      longitude REAL,
      image_urls TEXT,
      content_hash TEXT NOT NULL
    )
  `)

  d.exec(`CREATE INDEX IF NOT EXISTS idx_obs_source ON observations(source_record_id)`)
  d.exec(`CREATE INDEX IF NOT EXISTS idx_obs_hash ON observations(content_hash)`)

  // Change events — derived from comparing observations
  d.exec(`
    CREATE TABLE IF NOT EXISTS change_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_record_id INTEGER NOT NULL REFERENCES source_records(id),
      event_type TEXT NOT NULL,
      detected_at TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      detail TEXT
    )
  `)

  d.exec(`CREATE INDEX IF NOT EXISTS idx_events_type ON change_events(event_type)`)
  d.exec(`CREATE INDEX IF NOT EXISTS idx_events_date ON change_events(detected_at)`)

  // Parcels — permanent physical land identity. The canonical object everything attaches to.
  d.exec(`
    CREATE TABLE IF NOT EXISTS parcels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_key TEXT NOT NULL UNIQUE,
      village_id INTEGER,
      basin_id INTEGER,
      parcel_number INTEGER,
      village_name TEXT,
      basin_name TEXT,
      resolution_status TEXT NOT NULL DEFAULT 'resolved',
      resolution_method TEXT,
      resolution_confidence REAL DEFAULT 1.0,
      aradi_url TEXT,
      dls_url TEXT,
      latitude REAL,
      longitude REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  d.exec(`CREATE INDEX IF NOT EXISTS idx_parcels_key ON parcels(canonical_key)`)

  // Link source records to parcels
  d.exec(`
    CREATE TABLE IF NOT EXISTS source_record_parcels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_record_id INTEGER NOT NULL REFERENCES source_records(id),
      parcel_id INTEGER NOT NULL REFERENCES parcels(id),
      asset_level TEXT NOT NULL DEFAULT 'unknown',
      confidence REAL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source_record_id, parcel_id)
    )
  `)

  // Seed institutions
  const upsertInst = d.prepare(`
    INSERT INTO institutions (id, name_ar, name_en, website, source_type)
    VALUES (?, ?, ?, ?, 'bank')
    ON CONFLICT(id) DO NOTHING
  `)

  upsertInst.run("bank_al_etihad", "بنك الاتحاد", "Bank al Etihad", "https://www.bankaletihad.com")
  upsertInst.run("housing_bank", "بنك الاسكان", "Housing Bank", "https://hbtf.com")
  upsertInst.run("jordan_islamic", "البنك الإسلامي الأردني", "Jordan Islamic Bank", "https://jordanislamicbank.com")
  upsertInst.run("jordan_commercial", "البنك التجاري الأردني", "Jordan Commercial Bank", "https://www.jcbank.com.jo")
  upsertInst.run("jordan_kuwait", "البنك الأردني الكويتي", "Jordan Kuwait Bank", "https://www.jkb.com")
  upsertInst.run("capital_bank", "كابيتال بنك", "Capital Bank", "https://www.capitalbank.jo")
  upsertInst.run("arab_bank", "البنك العربي", "Arab Bank", "https://arabbank.jo")
  upsertInst.run("ahli_bank", "البنك الأهلي الأردني", "Jordan Ahli Bank", "https://ahli.com")
  upsertInst.run("safwa_bank", "بنك صفوة الإسلامي", "Safwa Islamic Bank", "https://www.safwabank.com")
}

// Helper: create a content hash from normalized property fields
export function contentHash(data: Record<string, any>): string {
  const keys = ["price", "area_sqm", "land_area_sqm", "property_type", "title", "description",
    "governorate", "city", "village", "basin", "parcel_number", "zoning", "latitude", "longitude"]
  const vals = keys.map(k => String(data[k] ?? "")).join("|")
  // Simple hash — not crypto, just change detection
  let h = 0
  for (let i = 0; i < vals.length; i++) {
    h = ((h << 5) - h + vals.charCodeAt(i)) | 0
  }
  return h.toString(36)
}
