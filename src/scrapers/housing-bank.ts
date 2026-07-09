import axios from "axios"
import * as cheerio from "cheerio"
import { getDb, contentHash } from "../db.js"

const INSTITUTION_ID = "housing_bank"
const BASE_URL = "https://hbtf.com"
const LIST_URL = `${BASE_URL}/en/new-realestate`

interface HBProperty {
  title: string
  price: number | null
  area_sqm: number | null
  land_area_sqm: number | null
  property_type: string | null
  reference: string
  url: string
  governorate: string | null
  floor: string | null
}

async function fetchListPage(page: number): Promise<{ properties: HBProperty[]; totalPages: number }> {
  const url = page === 1 ? LIST_URL : `${LIST_URL}?page=${page}`
  const resp = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept-Language": "en",
    },
    timeout: 30000,
  })

  const $ = cheerio.load(resp.data)
  const properties: HBProperty[] = []

  // Parse property cards
  $(".rl-st-list .rl-st-rightside, .realestate-card, [class*='property'], .card").each((_, el) => {
    const card = $(el)
    // Try various selectors for property data
    const title = card.find("h3, h4, .title, .property-title").first().text().trim()
    const priceText = card.find(".price, [class*='price']").first().text().trim()
    const price = priceText ? parseFloat(priceText.replace(/[^0-9.]/g, "")) || null : null
    const link = card.find("a[href*='realestate']").first().attr("href")
    const ref = card.find("[class*='ref'], .reference").first().text().trim()

    if (title || link) {
      properties.push({
        title,
        price,
        area_sqm: null,
        land_area_sqm: null,
        property_type: null,
        reference: ref || "",
        url: link ? (link.startsWith("http") ? link : `${BASE_URL}${link}`) : "",
        governorate: null,
        floor: null,
      })
    }
  })

  // Parse pagination
  const lastPageLink = $(".pagination a, nav a").last().attr("href")
  const totalPages = lastPageLink ? parseInt(lastPageLink.match(/page=(\d+)/)?.[1] || "1") : 1

  return { properties, totalPages }
}

// Detail pages have richer data (village, basin, parcel, zoning)
async function fetchDetailPage(url: string): Promise<Record<string, string>> {
  try {
    const resp = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Language": "en",
      },
      timeout: 15000,
    })
    const $ = cheerio.load(resp.data)
    const details: Record<string, string> = {}

    // Housing Bank uses <li> items like "Governorate: Balqa Governorate"
    // and <h3> for prices like "### JOD 89000"
    // Extract all text from the page body
    const bodyText = $("body").text()

    // Parse "Key: Value" patterns from list items and page text
    const kvPatterns: Record<string, RegExp> = {
      governorate: /governorate\s*:\s*([^\n]+)/i,
      directorate: /(?:land\s+)?directorate\s*:\s*([^\n]+)/i,
      village: /village\s*:\s*([^\n]+)/i,
      basin: /basin\s*:\s*([^\n]+)/i,
      plot: /(?:plot|parcel)\s*(?:no|number|#)?\s*:\s*([^\n]+)/i,
      zoning: /(?:zone|zoning)\s*:\s*([^\n]+)/i,
      area: /(?:built\s+)?area\s*:\s*([0-9,.]+)\s*(?:m|meter|sqm|sq)/i,
      land_area: /land\s+area\s*:\s*([0-9,.]+)\s*(?:m|meter|sqm|sq)/i,
      street: /street\s*(?:name)?\s*:\s*([^\n]+)/i,
      region: /region\s*:\s*([^\n]+)/i,
      floor: /floor\s*(?:no|number)?\s*:\s*([^\n]+)/i,
      reference: /reference\s*(?:no|number)?\s*:\s*([^\n]+)/i,
    }

    // Clean function: strip UI text that leaks in from adjacent page elements
    const cleanValue = (val: string): string => {
      return val
        .replace(/Apply\s*Now.*/i, "")
        .replace(/Discover\s*More.*/i, "")
        .replace(/Reference\s*Number.*/i, "")
        .replace(/Description:.*/i, "")
        .replace(/Area\s*:\s*\d+\s*Meter.*/i, "")
        .replace(/Land\s*Area\s*:\s*\d+\s*Meter.*/i, "")
        .trim()
    }

    for (const [key, regex] of Object.entries(kvPatterns)) {
      const match = bodyText.match(regex)
      if (match) details[key] = cleanValue(match[1])
    }

    // Arabic patterns as fallback
    const arPatterns: Record<string, RegExp> = {
      governorate: /المحافظة\s*:\s*([^\n]+)/,
      directorate: /المديرية\s*:\s*([^\n]+)/,
      village: /القرية\s*:\s*([^\n]+)/,
      basin: /الحوض\s*:\s*([^\n]+)/,
      plot: /(?:قطعة|رقم القطعة)\s*:\s*([^\n]+)/,
      zoning: /التنظيم\s*:\s*([^\n]+)/,
      area: /المساحة\s*:\s*([0-9,.]+)/,
    }

    for (const [key, regex] of Object.entries(arPatterns)) {
      if (!details[key]) {
        const match = bodyText.match(regex)
        if (match) details[key] = cleanValue(match[1])
      }
    }

    // Extract price — look for "JOD" followed by number, or number followed by "JOD"
    const priceMatch = bodyText.match(/JOD\s*([0-9,]+)/i) || bodyText.match(/([0-9,]+)\s*JOD/i)
    if (priceMatch) details.price = priceMatch[1].replace(/,/g, "")

    // Also try to get price from any element with price-like content
    const priceEl = $("h3, h2, .price, [class*='price']").filter((_, el) => $(el).text().includes("JOD")).first().text().trim()
    if (priceEl && !details.price) {
      const priceFromEl = priceEl.replace(/[^0-9]/g, "")
      if (priceFromEl) details.price = priceFromEl
    }

    // Get title
    const titleEl = $("h1, .property-title, h2").first().text().trim()
    if (titleEl) details.title = titleEl

    // Get description — Housing Bank descriptions often contain zoning info
    const descEl = $(".description, .property-description, [class*='desc'], p").filter((_, el) => {
      const t = $(el).text()
      return t.length > 30 && (t.includes("area") || t.includes("zone") || t.includes("m2") || t.includes("meter") || t.includes("مساحة"))
    }).first().text().trim()
    if (descEl) {
      // Strip "Description:" prefix and UI text contamination
      let cleanDesc = descEl
        .replace(/^Description:\s*/i, "")
        .replace(/Apply\s*Now.*/i, "")
        .replace(/Discover\s*More.*/i, "")
        .trim()
      if (cleanDesc.length > 10) {
        details.description = cleanDesc
        // Extract zoning from description like "Zone: Residential A"
        if (!details.zoning) {
          const zoningMatch = cleanDesc.match(/[Zz]one\s*:?\s*(Residential\s*[A-D]|Commercial\s*[A-D]|Industrial|Agricultural|Popular\s*Residential|ordinary\s*commercial|local\s*commercial|mixed\s*use|craft\s*industries)/i)
          if (zoningMatch) details.zoning = zoningMatch[1].trim()
        }
      }
    }

    // Get images
    const images: string[] = []
    $("img[src*='upload'], img[src*='property'], img[src*='realestate'], .gallery img, .slider img").each((_, img) => {
      const src = $(img).attr("src") || $(img).attr("data-src")
      if (src && !src.includes("icon") && !src.includes("logo")) {
        images.push(src.startsWith("http") ? src : `${BASE_URL}${src}`)
      }
    })
    if (images.length) details.images = JSON.stringify(images)

    // Get map coordinates — check iframe, Google Maps links, and data attributes
    const mapIframe = $("iframe[src*='google'], iframe[src*='maps']").first().attr("src")
    if (mapIframe) {
      const coordMatch = mapIframe.match(/q=(-?\d+\.\d+),(-?\d+\.\d+)/) ||
                          mapIframe.match(/center=(-?\d+\.\d+),(-?\d+\.\d+)/)
      if (coordMatch) {
        details.latitude = coordMatch[1]
        details.longitude = coordMatch[2]
      }
    }

    // Also check for Google Maps links (short or long form)
    if (!details.latitude) {
      const mapLink = $("a[href*='maps.google'], a[href*='maps.app'], a[href*='goo.gl']").first().attr("href")
      if (mapLink) {
        details.raw_map_url = mapLink
        // Long-form coordinates
        const coordMatch = mapLink.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ||
                           mapLink.match(/q=(-?\d+\.\d+),(-?\d+\.\d+)/) ||
                           mapLink.match(/center=(-?\d+\.\d+),(-?\d+\.\d+)/)
        if (coordMatch) {
          details.latitude = coordMatch[1]
          details.longitude = coordMatch[2]
        }
      }
    }

    return details
  } catch (err: any) {
    console.warn(`[housing] Failed to fetch detail: ${url} — ${err.message}`)
    return {}
  }
}

export async function scrapeHousingBank(): Promise<number> {
  const db = getDb()
  const now = new Date().toISOString()

  const run = db.prepare(`
    INSERT INTO ingestion_runs (institution_id, started_at, status, parser_version)
    VALUES (?, ?, 'running', 'housing-v2-category')
  `).run(INSTITUTION_ID, now)
  const runId = run.lastInsertRowid as number

  try {
    // Step 1: Discover ALL property URLs by scraping each category separately
    // This avoids pagination instability where the main list returns different subsets
    const allPropertyUrls: Array<{ url: string; ref: string; category: string }> = []
    const seenRefs = new Set<string>()

    const categories = [
      { name: "buildings", path: "/en/new-realestate/category/buildings" },
      { name: "units", path: "/en/new-realestate/category/re-units" },
      { name: "lands", path: "/en/new-realestate/category/lands" },
    ]

    const extractPropertyLinks = ($: cheerio.CheerioAPI, category: string) => {
      let found = 0
      $("a[href*='new-realestate/']").each((_, el) => {
        const href = $(el).attr("href")
        if (href && href.includes("AQ-") && !href.includes("filter") && !href.includes("category")) {
          const fullUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`
          const ref = href.match(/(AQ-[A-Z]+-\d+)/)?.[1] || href.split("/").pop() || ""
          if (ref && !seenRefs.has(ref)) {
            seenRefs.add(ref)
            allPropertyUrls.push({ url: fullUrl, ref, category })
            found++
          }
        }
      })
      return found
    }

    for (const cat of categories) {
      console.log(`[housing] Fetching category: ${cat.name}`)
      const catUrl = `${BASE_URL}${cat.path}`

      try {
        // Fetch page 1 of category
        const firstPage = await axios.get(catUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
          timeout: 30000,
        })
        const $first = cheerio.load(firstPage.data)
        extractPropertyLinks($first, cat.name)

        // Find max page number for this category
        const pageNums = new Set<number>()
        $first("a[href*='page=']").each((_, el) => {
          const href = $first(el).attr("href") || ""
          const num = parseInt(href.match(/page=(\d+)/)?.[1] || "0")
          if (num > 1) pageNums.add(num)
        })

        const maxPage = pageNums.size > 0 ? Math.max(...pageNums) : 1
        console.log(`[housing]   ${cat.name} has ${maxPage} pages`)

        // Fetch remaining pages
        for (let p = 2; p <= maxPage; p++) {
          try {
            const pageResp = await axios.get(`${catUrl}?page=${p}`, {
              headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
              timeout: 30000,
            })
            extractPropertyLinks(cheerio.load(pageResp.data), cat.name)
            await new Promise(r => setTimeout(r, 400))
          } catch (err: any) {
            console.warn(`[housing]   Failed page ${p}: ${err.message}`)
          }
        }

        console.log(`[housing]   ${cat.name}: ${allPropertyUrls.filter(p => p.category === cat.name).length} unique`)
      } catch (err: any) {
        console.warn(`[housing] Failed to fetch category ${cat.name}: ${err.message}`)
      }

      await new Promise(r => setTimeout(r, 500))
    }

    // Also scrape the main (unfiltered) list to catch anything missed
    console.log(`[housing] Fetching main list as fallback...`)
    try {
      const mainResp = await axios.get(LIST_URL, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        timeout: 30000,
      })
      const $main = cheerio.load(mainResp.data)
      const mainPageNums = new Set<number>()
      $main("a[href*='page=']").each((_, el) => {
        const num = parseInt(($main(el).attr("href") || "").match(/page=(\d+)/)?.[1] || "0")
        if (num > 1) mainPageNums.add(num)
      })
      extractPropertyLinks($main, "main")
      const mainMax = mainPageNums.size > 0 ? Math.max(...mainPageNums) : 1
      for (let p = 2; p <= mainMax; p++) {
        try {
          const pr = await axios.get(`${LIST_URL}?page=${p}`, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
            timeout: 30000,
          })
          extractPropertyLinks(cheerio.load(pr.data), "main")
          await new Promise(r => setTimeout(r, 400))
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }

    console.log(`[housing] Total unique property URLs: ${allPropertyUrls.length}`)

    // Step 2: Fetch each detail page for full data
    let newCount = 0
    let changedCount = 0
    let processed = 0

    const upsertSource = db.prepare(`
      INSERT INTO source_records (institution_id, source_property_id, source_url, raw_data, first_seen_at, last_seen_at, currently_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(institution_id, source_property_id) DO UPDATE SET
        raw_data = excluded.raw_data,
        last_seen_at = excluded.last_seen_at,
        currently_active = 1
    `)

    const insertObs = db.prepare(`
      INSERT INTO observations (source_record_id, ingestion_run_id, observed_at, price, area_sqm, land_area_sqm,
        property_type, title, description, governorate, city, neighborhood, village, basin, parcel_number,
        zoning, latitude, longitude, image_urls, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const getSource = db.prepare(`SELECT id FROM source_records WHERE institution_id = ? AND source_property_id = ?`)
    const getLastObs = db.prepare(`SELECT content_hash, price FROM observations WHERE source_record_id = ? ORDER BY observed_at DESC LIMIT 1`)
    const insertEvent = db.prepare(`
      INSERT INTO change_events (source_record_id, event_type, detected_at, old_value, new_value, detail)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    for (const prop of allPropertyUrls) {
      processed++
      if (processed % 20 === 0) console.log(`[housing] Processing ${processed}/${allPropertyUrls.length}...`)

      const details = await fetchDetailPage(prop.url)
      const price = details.price ? parseFloat(details.price.replace(/[^0-9.]/g, "")) || null : null
      const areaSqm = details.area ? parseFloat(details.area.replace(/[^0-9.]/g, "")) || null : null
      const landArea = details.land_area ? parseFloat(details.land_area.replace(/[^0-9.]/g, "")) || null : null

      const normalized = {
        price,
        area_sqm: areaSqm,
        land_area_sqm: landArea,
        property_type: details.type || (prop.ref.includes("LND") ? "land" : prop.ref.includes("BLD") ? "building" : "unit"),
        title: details.title || prop.ref,
        description: details.description || null,
        governorate: details.governorate || null,
        city: null as string | null,
        neighborhood: details.directorate || null,
        village: details.village || null,
        basin: details.basin || null,
        parcel_number: details.plot || null,
        zoning: details.zoning || null,
        latitude: details.latitude ? parseFloat(details.latitude) : null,
        longitude: details.longitude ? parseFloat(details.longitude) : null,
        image_urls: details.images || null,
      }

      const hash = contentHash(normalized)

      upsertSource.run(INSTITUTION_ID, prop.ref, prop.url, JSON.stringify(details), now, now)

      const sourceRow = getSource.get(INSTITUTION_ID, prop.ref) as { id: number } | undefined
      if (!sourceRow) continue
      const srcId = sourceRow.id

      const lastObs = getLastObs.get(srcId) as { content_hash: string; price: number } | undefined

      if (!lastObs) {
        newCount++
        insertEvent.run(srcId, "NEW", now, null, null,
          `${normalized.property_type}: ${normalized.title} — ${price ? price + " JOD" : "no price"}`)
      } else if (lastObs.content_hash !== hash) {
        changedCount++
        if (price && lastObs.price && price !== lastObs.price) {
          const pctChange = ((price - lastObs.price) / lastObs.price * 100).toFixed(1)
          const eventType = price < lastObs.price ? "PRICE_REDUCED" : "PRICE_INCREASED"
          insertEvent.run(srcId, eventType, now, String(lastObs.price), String(price),
            `${lastObs.price} → ${price} JOD (${pctChange}%)`)
        }
      } else {
        continue
      }

      insertObs.run(
        srcId, runId, now,
        normalized.price, normalized.area_sqm, normalized.land_area_sqm,
        normalized.property_type, normalized.title, normalized.description,
        normalized.governorate, normalized.city, normalized.neighborhood,
        normalized.village, normalized.basin, normalized.parcel_number,
        normalized.zoning, normalized.latitude, normalized.longitude,
        normalized.image_urls, hash
      )

      // Polite delay between detail page requests
      await new Promise(r => setTimeout(r, 300))
    }

    // Increment consecutive_misses for properties NOT seen this run.
    // Only mark as removed after 3+ consecutive misses to avoid false removals
    // from pagination instability.
    const MISS_THRESHOLD = 3
    db.prepare(`
      UPDATE source_records SET consecutive_misses = consecutive_misses + 1
      WHERE institution_id = ? AND last_seen_at < ? AND currently_active = 1
    `).run(INSTITUTION_ID, now)

    // Reset consecutive_misses for properties we DID see
    db.prepare(`
      UPDATE source_records SET consecutive_misses = 0
      WHERE institution_id = ? AND last_seen_at >= ?
    `).run(INSTITUTION_ID, now)

    // Only mark as removed after threshold
    const markInactive = db.prepare(`
      UPDATE source_records SET currently_active = 0
      WHERE institution_id = ? AND consecutive_misses >= ? AND currently_active = 1
    `)
    const removed = markInactive.run(INSTITUTION_ID, MISS_THRESHOLD)
    const removedCount = removed.changes

    // Count how many are in "warning" state (missed but not yet removed)
    const warningCount = (db.prepare(`
      SELECT COUNT(*) as c FROM source_records
      WHERE institution_id = ? AND consecutive_misses > 0 AND consecutive_misses < ? AND currently_active = 1
    `).get(INSTITUTION_ID, MISS_THRESHOLD) as { c: number }).c

    if (removedCount > 0) {
      const justRemoved = db.prepare(`
        SELECT id, source_property_id FROM source_records
        WHERE institution_id = ? AND currently_active = 0 AND consecutive_misses >= ?
      `).all(INSTITUTION_ID, MISS_THRESHOLD) as Array<{ id: number; source_property_id: string }>
      for (const r of justRemoved) {
        const existingEvent = db.prepare(`
          SELECT 1 FROM change_events WHERE source_record_id = ? AND event_type = 'REMOVED' AND detected_at >= date(?)
        `).get(r.id, now)
        if (!existingEvent) {
          insertEvent.run(r.id, "REMOVED", now, null, null, `Property ${r.source_property_id} no longer listed (missed ${MISS_THRESHOLD}+ consecutive runs)`)
        }
      }
    }

    db.prepare(`
      UPDATE ingestion_runs SET completed_at = ?, records_found = ?, records_new = ?,
        records_changed = ?, records_removed = ?, status = 'completed'
      WHERE id = ?
    `).run(new Date().toISOString(), allPropertyUrls.length, newCount, changedCount, removedCount, runId)

    console.log(`[housing] Done: ${allPropertyUrls.length} found, ${newCount} new, ${changedCount} changed, ${removedCount} confirmed removed, ${warningCount} missed (not yet removed)`)
    return allPropertyUrls.length

  } catch (err: any) {
    db.prepare(`UPDATE ingestion_runs SET completed_at = ?, status = 'failed', error = ? WHERE id = ?`)
      .run(new Date().toISOString(), err.message, runId)
    console.error(`[housing] Failed:`, err.message)
    throw err
  }
}
