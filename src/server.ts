import express from "express"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { getDb } from "./db.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
const PORT = 4000
const BASE = process.env.BASE_PATH || ""  // "/intel" in production, "" locally

app.set("view engine", "ejs")
app.set("views", join(__dirname, "..", "views"))

const fmt = (n: number | null) => n != null ? Math.round(n).toLocaleString("en-US") : "—"
const fmtJod = (n: number | null) => n != null ? `${Math.round(n).toLocaleString("en-US")} JOD` : "—"

// Bank purchase process info — maintained per institution
const PURCHASE_INFO: Record<string, { summary: string; methods: string[]; url_field: string; last_verified: string }> = {
  housing_bank: {
    summary: "Submit a proposed purchase price and preferred payment method. The bank reviews applications and determines final eligibility and terms.",
    methods: ["Cash", "Installments", "Bank financing"],
    url_field: "source_url",
    last_verified: "July 2026",
  },
  bank_al_etihad: {
    summary: "Submit an application through the bank's property inquiry form. The bank will review and respond with available terms.",
    methods: ["Cash", "Bank financing"],
    url_field: "source_url",
    last_verified: "July 2026",
  },
  moj_auctions: {
    summary: "This is a judicial auction conducted through the Ministry of Justice. Bidding takes place on the MOJ electronic auction platform. Registration and a deposit are typically required to participate.",
    methods: ["Auction bid", "Cash"],
    url_field: "source_url",
    last_verified: "July 2026",
  },
}

// ─── Property List ─────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  const db = getDb()
  const type = (req.query.type as string) || ""
  const bank = (req.query.bank as string) || ""
  const q = (req.query.q as string) || ""
  const sort = (req.query.sort as string) || "price_asc"

  let where = "WHERE sr.currently_active = 1"
  const params: any[] = []

  if (type) { where += " AND srp.asset_level = ?"; params.push(type) }
  if (bank) { where += " AND sr.institution_id = ?"; params.push(bank) }
  if (q) {
    where += " AND (o.title LIKE ? OR o.village LIKE ? OR o.basin LIKE ? OR p.canonical_key LIKE ? OR p.village_name LIKE ? OR p.basin_name LIKE ?)"
    const like = `%${q}%`
    params.push(like, like, like, like, like, like)
  }

  const orderBy = sort === "price_desc" ? "o.price DESC"
    : sort === "price_asc" ? "o.price ASC"
    : sort === "area_desc" ? "o.area_sqm DESC"
    : sort === "newest" ? "sr.first_seen_at DESC"
    : "o.price ASC"

  const properties = db.prepare(`
    SELECT sr.id as source_id, sr.source_property_id, sr.institution_id, sr.source_url, sr.first_seen_at,
      o.title, o.price, o.area_sqm, o.land_area_sqm, o.property_type, o.village, o.basin, o.parcel_number,
      o.zoning, o.latitude, o.longitude, o.description,
      p.canonical_key, p.aradi_url, p.resolution_status,
      p.village_name, p.basin_name, p.basin_id, p.parcel_number as parcel_num,
      srp.asset_level,
      i.name_en as bank_name, i.name_ar as bank_name_ar
    FROM source_records sr
    JOIN observations o ON o.source_record_id = sr.id
      AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
    LEFT JOIN source_record_parcels srp ON srp.source_record_id = sr.id
    LEFT JOIN parcels p ON p.id = srp.parcel_id
    JOIN institutions i ON i.id = sr.institution_id
    ${where}
    ORDER BY ${orderBy}
    LIMIT 1000
  `).all(...params) as any[]

  const stats = db.prepare(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN p.resolution_status = 'resolved' THEN 1 ELSE 0 END) as resolved,
      COUNT(DISTINCT p.id) as unique_parcels
    FROM source_records sr
    LEFT JOIN source_record_parcels srp ON srp.source_record_id = sr.id
    LEFT JOIN parcels p ON p.id = srp.parcel_id
    WHERE sr.currently_active = 1
  `).get() as any

  const banks = db.prepare(`
    SELECT i.id, i.name_en, i.name_ar, COUNT(*) as count
    FROM source_records sr
    JOIN institutions i ON i.id = sr.institution_id
    WHERE sr.currently_active = 1
    GROUP BY sr.institution_id ORDER BY count DESC
  `).all() as any[]

  res.render("index", { properties, stats, banks, query: { type, bank, q, sort }, fmt, fmtJod, base: BASE })
})

// ─── Property Passport ─────────────────────────────────────────────────────────

// Human-readable URL: /property/housing-bank-AQ-LND-100453
app.get("/property/:slug", (req, res, next) => {
  try {
  const db = getDb()
  const slug = req.params.slug

  // Support both numeric IDs (legacy) and human-readable slugs
  let property: any
  const numId = parseInt(slug)
  if (!isNaN(numId) && String(numId) === slug) {
    property = db.prepare(`
      SELECT sr.id as source_id, sr.source_property_id, sr.institution_id, sr.source_url,
        sr.first_seen_at, sr.last_seen_at,
        o.title, o.price, o.area_sqm, o.land_area_sqm, o.property_type, o.village, o.basin,
        o.parcel_number, o.zoning, o.latitude, o.longitude, o.description, o.image_urls, o.governorate,
        p.canonical_key, p.aradi_url, p.resolution_status, p.village_name, p.basin_name,
        p.village_id, p.basin_id, p.parcel_number as p_parcel_number,
        srp.asset_level,
        i.id as inst_id, i.name_en as bank_name, i.name_ar as bank_name_ar, i.website as bank_website
      FROM source_records sr
      JOIN observations o ON o.source_record_id = sr.id
        AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
      LEFT JOIN source_record_parcels srp ON srp.source_record_id = sr.id
      LEFT JOIN parcels p ON p.id = srp.parcel_id
      JOIN institutions i ON i.id = sr.institution_id
      WHERE sr.id = ?
    `).get(numId) as any
  } else {
    // Parse slug: "housing-bank-AQ-LND-100453" → institution guess + source_property_id
    property = db.prepare(`
      SELECT sr.id as source_id, sr.source_property_id, sr.institution_id, sr.source_url,
        sr.first_seen_at, sr.last_seen_at,
        o.title, o.price, o.area_sqm, o.land_area_sqm, o.property_type, o.village, o.basin,
        o.parcel_number, o.zoning, o.latitude, o.longitude, o.description, o.image_urls, o.governorate,
        p.canonical_key, p.aradi_url, p.resolution_status, p.village_name, p.basin_name,
        p.village_id, p.basin_id, p.parcel_number as p_parcel_number,
        srp.asset_level,
        i.id as inst_id, i.name_en as bank_name, i.name_ar as bank_name_ar, i.website as bank_website
      FROM source_records sr
      JOIN observations o ON o.source_record_id = sr.id
        AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
      LEFT JOIN source_record_parcels srp ON srp.source_record_id = sr.id
      LEFT JOIN parcels p ON p.id = srp.parcel_id
      JOIN institutions i ON i.id = sr.institution_id
      WHERE sr.source_property_id = ? OR sr.source_property_id = ?
    `).get(slug, slug.replace(/^.*?-(?=[A-Z]{2}-|[a-z]{2}-)/i, "")) as any
  }

  if (!property) return res.status(404).send("Property not found")

  // Create a plain mutable copy of the DB row
  const p = { ...property } as any

  // Computed fields as separate objects (EJS 6 doesn't allow mutation of passed objects)
  const bankSlug = p.inst_id?.replace(/_/g, "-") || "unknown"
  const slug2 = `${bankSlug}-${p.source_property_id}`

  const assetLevel = p.asset_level || "unknown"
  const landArea = p.land_area_sqm || (assetLevel === "parcel" ? p.area_sqm : null)
  const builtArea = assetLevel !== "parcel" ? p.area_sqm : null
  const pricePerLandSqm = p.price && landArea ? Math.round(p.price / landArea) : null
  const pricePerBuiltSqm = p.price && builtArea ? Math.round(p.price / builtArea) : null

  // Build dynamic verification checklist
  const verified: Array<{ label: string }> = []
  const needsVerification: Array<{ label: string }> = []

  if (p.bank_name) verified.push({ label: "مقدم من " + p.bank_name })
  if (p.price) verified.push({ label: "السعر المطلوب: " + fmtJod(p.price) })
  if (p.asset_level) verified.push({ label: "نوع العقار: " + (assetLevel === "parcel" ? "أرض" : assetLevel === "building" ? "مبنى" : "شقة") })
  if (p.area_sqm) verified.push({ label: "المساحة: " + fmt(p.area_sqm) + " م²" })
  if (p.resolution_status === "resolved") verified.push({ label: "تم تحديد القطعة والتحقق منها" })
  else if (p.canonical_key) verified.push({ label: "معرّفات القطعة متوفرة" })
  if (p.latitude && p.longitude) verified.push({ label: "إحداثيات الموقع متوفرة" })
  if (p.zoning) verified.push({ label: "التنظيم: " + p.zoning })
  verified.push({ label: "آخر فحص: " + new Date(p.last_seen_at).toLocaleDateString("ar-JO") })

  needsVerification.push({ label: "حالة الملكية وسند التسجيل" })
  needsVerification.push({ label: "الرهون والأعباء" })
  needsVerification.push({ label: "الوصول الفعلي والواجهة على الشارع" })
  if (!p.zoning) needsVerification.push({ label: "التنظيم وحقوق البناء" })
  needsVerification.push({ label: "توفر المياه والصرف الصحي والكهرباء" })
  needsVerification.push({ label: "حالة الإشغال أو الاستئجار" })
  needsVerification.push({ label: "المسح والحدود" })
  needsVerification.push({ label: "شروط الشراء النهائية" })

  const purchaseInfo = PURCHASE_INFO[p.inst_id] || null

  // History
  const history = db.prepare(`
    SELECT observed_at, price FROM observations
    WHERE source_record_id = ? ORDER BY observed_at ASC
  `).all(property.source_id) as Array<{ observed_at: string; price: number }>

  const events = db.prepare(`
    SELECT event_type, detected_at, old_value, new_value, detail
    FROM change_events WHERE source_record_id = ?
    ORDER BY detected_at DESC
  `).all(property.source_id) as any[]

  let sameParcel: any[] = []
  if (property.canonical_key) {
    sameParcel = db.prepare(`
      SELECT sr.id as source_id, sr.source_property_id, sr.institution_id,
        o.title, o.price, o.property_type, srp.asset_level, i.name_en as bank_name, i.name_ar as bank_name_ar,
        i.id as inst_id
      FROM source_record_parcels srp
      JOIN parcels p ON p.id = srp.parcel_id
      JOIN source_records sr ON sr.id = srp.source_record_id
      JOIN observations o ON o.source_record_id = sr.id
        AND o.id = (SELECT MAX(o2.id) FROM observations o2 WHERE o2.source_record_id = sr.id)
      JOIN institutions i ON i.id = sr.institution_id
      WHERE p.canonical_key = ? AND sr.id != ? AND sr.currently_active = 1
    `).all(property.canonical_key, property.source_id) as any[]
  }

  // Express 5 + EJS: pass all data as a single object
  console.log("Rendering property, prop keys:", Object.keys(p).length, "verified:", verified.length)
  res.render("passport", {
    prop: p, history, events, sameParcel, fmt, fmtJod,
    assetLevel, pricePerLandSqm, pricePerBuiltSqm,
    verified, needsVerification, purchaseInfo, propSlug: slug2,
    base: BASE,
  })
  } catch (err: any) {
    console.error("Property route error:", err.message)
    next(err)
  }
})

app.listen(PORT, () => {
  console.log(`Jordan Intel running at http://localhost:${PORT}`)
})
