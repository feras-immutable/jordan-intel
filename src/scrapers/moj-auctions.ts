import axios from "axios"
import * as cheerio from "cheerio"
import https from "https"
import { getDb, contentHash } from "../db.js"

const INSTITUTION_ID = "moj_auctions"
const agent = new https.Agent({ rejectUnauthorized: false })

// Category tokens from MOJ homepage
const CATEGORIES = [
  { name: "land", label: "أرض/ مجمع", token: "4qy8OuhsH9jUT7LUpUd0vrrej7DZFIlrYUbJDNhy_E3Q3Hxei9O5hIhNPUTv2JN03pl_whWDUDInBYIvXX4lvdTwiPaw7yNJ4we5qp0TYFE" },
  { name: "apartment", label: "شقة/ مكتب", token: "4qy8OuhsH9jUT7LUpUd0vsKYzlwq1SjXjxrGSTzEzuhPMz15gnBp8tk-ZrR1_GDKuS7Rnt4Ksiv_YxV_tPdAyDQHBnJFqmY65P9mbTZMRqc" },
]

interface MojAuction {
  auctionId: string
  auctionNumId: number
  category: string
  governorate: string | null
  directorate: string | null
  village: string | null
  basin: string | null
  basinNumber: string | null
  neighborhood: string | null
  parcelNumber: string | null
  parcelType: string | null
  area: number | null
  court: string | null
  caseNumber: string | null
  announcementType: string | null
  startDate: string | null
  endDate: string | null
  bidCount: number
  estimatedValue: number | null
  openingValue: number | null
  currentValue: number | null
}

function parseAuctions(html: string, category: string): MojAuction[] {
  const $ = cheerio.load(html)
  const auctions: MojAuction[] = []

  // Each auction is in a repeater item — find them by the auction ID pattern
  const auctionIdPattern = /SetCurrentAuctionID\((\d+)\)/g
  const seenIds = new Set<number>()
  let match
  while ((match = auctionIdPattern.exec(html)) !== null) {
    seenIds.add(parseInt(match[1]))
  }

  // The repeater creates div blocks for each auction
  // Find each repeater item by looking for the auction number pattern
  const repeaterItems = $("[id*=AuctionsListRepeater]").children("div")

  // Alternative: parse by finding sections that start with "رقم المزاد"
  const fullText = html
  const auctionBlocks = fullText.split(/رقم المزاد\s*:/).slice(1) // Split by auction number marker

  for (const block of auctionBlocks) {
    const auction: Partial<MojAuction> = { category }

    // Auction number/ID
    const numMatch = block.match(/^([^\s<]+)/)
    auction.auctionId = numMatch ? numMatch[1].trim() : ""

    // Numeric ID from SetCurrentAuctionID
    const idMatch = block.match(/SetCurrentAuctionID\((\d+)\)/)
    auction.auctionNumId = idMatch ? parseInt(idMatch[1]) : 0

    // Strip HTML tags from block for easier regex matching
    const text = block.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

    // Governorate — text between المحافظة and المديرية
    const govMatch = text.match(/المحافظة\s+(.+?)\s+المديرية/)
    auction.governorate = govMatch ? govMatch[1].trim() : null

    // Directorate
    const dirMatch = text.match(/المديرية\s+(.+?)\s+القرية/)
    auction.directorate = dirMatch ? dirMatch[1].trim() : null

    // Village
    const villMatch = text.match(/القرية\s+(.+?)\s+الحوض/)
    auction.village = villMatch ? villMatch[1].trim() : null

    // Basin (format: "023/البلد" or just name)
    const basinMatch = text.match(/الحوض\s+(.+?)\s+الحي/)
    if (basinMatch) {
      const raw = basinMatch[1].trim()
      const numName = raw.match(/^(\d+)\/(.+)/)
      if (numName) {
        auction.basinNumber = numName[1]
        auction.basin = numName[2].trim()
      } else {
        auction.basin = raw
      }
    }

    // Neighborhood
    const neighMatch = text.match(/الحي\s+(.+?)\s+رقم القطعة/)
    auction.neighborhood = neighMatch ? neighMatch[1].trim() : null

    // Parcel number
    const parcelMatch = text.match(/رقم القطعة\s+(\d+)/)
    auction.parcelNumber = parcelMatch ? parcelMatch[1] : null

    // Parcel type
    const typeMatch = text.match(/نوع القطعة\s+(.+?)\s+مساحة/)
    auction.parcelType = typeMatch ? typeMatch[1].trim() : null

    // Area
    const areaMatch = text.match(/مساحة القطعة\s+([\d.]+)/)
    auction.area = areaMatch ? parseFloat(areaMatch[1]) : null

    // Court
    const courtMatch = text.match(/المحكمة\s*\/\s*الدائرة\s+(.+?)\s+رقم الدعوى/)
    auction.court = courtMatch ? courtMatch[1].trim() : null

    // Case number
    const caseMatch = text.match(/رقم الدعوى\s+(?:ا\s+)?(.+?)\s+الإعلان/)
    auction.caseNumber = caseMatch ? caseMatch[1].trim() : null

    // Announcement type
    const annMatch = text.match(/الإعلان\s+(.+?)\s+تاريخ بداية/)
    auction.announcementType = annMatch ? annMatch[1].trim() : null

    // Bid count
    const bidMatch = text.match(/عدد المزاودات\s*:\s*(\d+)/)
    auction.bidCount = bidMatch ? parseInt(bidMatch[1]) : 0

    // Values
    const estMatch = text.match(/القيمة المقدرة\s*:?\s*([\d,]+(?:\.\d+)?)/)
    auction.estimatedValue = estMatch ? parseFloat(estMatch[1].replace(/,/g, "")) : null

    const openMatch = text.match(/(?:القيمة الافتتاحية|الابتدائي)\s*:?\s*([\d,]+(?:\.\d+)?)/)
    auction.openingValue = openMatch ? parseFloat(openMatch[1].replace(/,/g, "")) : null

    const curMatch = text.match(/القيمة الحالية\s*:?\s*([\d,]+(?:\.\d+)?)/)
    auction.currentValue = curMatch ? parseFloat(curMatch[1].replace(/,/g, "")) : null

    // Start/end dates
    const startMatch = text.match(/تاريخ بداية الاعلان\s+([\d/]+)/)
    auction.startDate = startMatch ? startMatch[1] : null

    const endMatch = text.match(/تاريخ انتهاء الاعلان\s+([\d/]+)/)
    auction.endDate = endMatch ? endMatch[1] : null

    if (auction.auctionId || auction.auctionNumId) {
      auctions.push(auction as MojAuction)
    }
  }

  return auctions
}

export async function scrapeMojAuctions(): Promise<number> {
  const db = getDb()
  const now = new Date().toISOString()

  // Ensure MOJ institution exists
  db.prepare(`INSERT INTO institutions (id, name_ar, name_en, website, source_type) VALUES (?, ?, ?, ?, 'auction') ON CONFLICT(id) DO NOTHING`)
    .run("moj_auctions", "المزادات الإلكترونية - وزارة العدل", "MOJ Judicial Auctions", "https://auctions.moj.gov.jo")

  const run = db.prepare(`INSERT INTO ingestion_runs (institution_id, started_at, status, parser_version) VALUES (?, ?, 'running', 'moj-v1')`)
    .run(INSTITUTION_ID, now)
  const runId = run.lastInsertRowid as number

  let totalFound = 0
  let newCount = 0

  try {
    for (const cat of CATEGORIES) {
      console.log(`[moj] Fetching ${cat.label} (${cat.name})...`)
      const url = `https://auctions.moj.gov.jo/AuctionsList.aspx?token=${cat.token}`

      // Fetch first page
      const firstResp = await axios.get(url, {
        httpsAgent: agent,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        timeout: 20000,
      })

      let allAuctions = parseAuctions(firstResp.data, cat.name)
      console.log(`[moj] Page 1: ${allAuctions.length} auctions`)

      // Find how many pages exist and paginate with ASP.NET postback
      const $ = cheerio.load(firstResp.data)
      const pageLinks: string[] = []
      $("a[href*='rptPaging']").each((_, el) => {
        const href = $(el).attr("href") || ""
        const target = href.match(/__doPostBack\('([^']+)'/)?.[1]
        if (target) pageLinks.push(target)
      })

      console.log(`[moj] Found ${pageLinks.length} additional pages`)

      // Fetch remaining pages via POST
      for (let p = 0; p < pageLinks.length; p++) {
        const viewState = $("input[name='__VIEWSTATE']").val() as string
        const viewStateGen = $("input[name='__VIEWSTATEGENERATOR']").val() as string || ""

        try {
          const pageResp = await axios.post(url, new URLSearchParams({
            "__VIEWSTATE": viewState,
            "__VIEWSTATEGENERATOR": viewStateGen,
            "__EVENTTARGET": pageLinks[p],
            "__EVENTARGUMENT": "",
          }).toString(), {
            httpsAgent: agent,
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
              "Content-Type": "application/x-www-form-urlencoded",
              "Referer": url,
            },
            timeout: 20000,
          })

          const pageAuctions = parseAuctions(pageResp.data, cat.name)
          // Dedupe by auction ID
          const existingIds = new Set(allAuctions.map(a => a.auctionId))
          const newFromPage = pageAuctions.filter(a => !existingIds.has(a.auctionId))
          allAuctions.push(...newFromPage)
          console.log(`[moj] Page ${p + 2}: ${pageAuctions.length} parsed, ${newFromPage.length} new (total: ${allAuctions.length})`)

          // Update $ for next page's ViewState
          const $next = cheerio.load(pageResp.data)
          $("input[name='__VIEWSTATE']").val($next("input[name='__VIEWSTATE']").val() as string)

          await new Promise(r => setTimeout(r, 800))
        } catch (err: any) {
          console.warn(`[moj] Page ${p + 2} failed: ${err.message}`)
        }
      }

      const auctions = allAuctions
      console.log(`[moj] Total ${cat.name}: ${auctions.length} auctions`)

      for (const a of auctions) {
        const sourceId = a.auctionId || String(a.auctionNumId)
        if (!sourceId || sourceId === "0") continue

        totalFound++

        const title = `${a.village || ""} - ${a.basin || ""} - Parcel ${a.parcelNumber || "?"}`
        const price = a.estimatedValue || a.openingValue || a.currentValue || null

        // Extract basin number
        const basinNum = a.basinNumber ? parseInt(a.basinNumber) : null

        const normalized = {
          price,
          area_sqm: a.area,
          land_area_sqm: null as number | null,
          property_type: cat.name,
          title,
          description: `${a.announcementType || ""} | ${a.court || ""} | Case: ${a.caseNumber || ""} | Bids: ${a.bidCount} | Type: ${a.parcelType || ""}`,
          governorate: a.governorate,
          city: null as string | null,
          neighborhood: a.neighborhood,
          village: a.village,
          basin: a.basin ? (basinNum ? `${a.basin} (${basinNum})` : a.basin) : null,
          parcel_number: a.parcelNumber,
          zoning: null as string | null,
          latitude: null as number | null,
          longitude: null as number | null,
          image_urls: null as string | null,
        }

        const hash = contentHash(normalized)

        // Upsert source record
        db.prepare(`
          INSERT INTO source_records (institution_id, source_property_id, source_url, raw_data, first_seen_at, last_seen_at, currently_active)
          VALUES (?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(institution_id, source_property_id) DO UPDATE SET
            raw_data = excluded.raw_data, last_seen_at = excluded.last_seen_at, currently_active = 1
        `).run(INSTITUTION_ID, sourceId, "https://auctions.moj.gov.jo/", JSON.stringify(a), now, now)

        const sourceRow = db.prepare(`SELECT id FROM source_records WHERE institution_id = ? AND source_property_id = ?`)
          .get(INSTITUTION_ID, sourceId) as { id: number } | undefined
        if (!sourceRow) continue

        const lastObs = db.prepare(`SELECT content_hash FROM observations WHERE source_record_id = ? ORDER BY observed_at DESC LIMIT 1`)
          .get(sourceRow.id) as { content_hash: string } | undefined

        if (!lastObs) {
          newCount++
          db.prepare(`INSERT INTO change_events (source_record_id, event_type, detected_at, detail) VALUES (?, 'NEW', ?, ?)`)
            .run(sourceRow.id, now, `Auction: ${title} — ${price ? price + " JOD" : "no value"}`)
        } else if (lastObs.content_hash === hash) {
          continue
        }

        db.prepare(`
          INSERT INTO observations (source_record_id, ingestion_run_id, observed_at, price, area_sqm, land_area_sqm,
            property_type, title, description, governorate, city, neighborhood, village, basin, parcel_number,
            zoning, latitude, longitude, image_urls, content_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          sourceRow.id, runId, now,
          normalized.price, normalized.area_sqm, normalized.land_area_sqm,
          normalized.property_type, normalized.title, normalized.description,
          normalized.governorate, normalized.city, normalized.neighborhood,
          normalized.village, normalized.basin, normalized.parcel_number,
          normalized.zoning, normalized.latitude, normalized.longitude,
          normalized.image_urls, hash
        )
      }

      await new Promise(r => setTimeout(r, 500))
    }

    db.prepare(`UPDATE ingestion_runs SET completed_at = ?, records_found = ?, records_new = ?, status = 'completed' WHERE id = ?`)
      .run(new Date().toISOString(), totalFound, newCount, runId)

    console.log(`[moj] Done: ${totalFound} auctions found, ${newCount} new`)
    return totalFound

  } catch (err: any) {
    db.prepare(`UPDATE ingestion_runs SET completed_at = ?, status = 'failed', error = ? WHERE id = ?`)
      .run(new Date().toISOString(), err.message, runId)
    console.error(`[moj] Failed:`, err.message)
    throw err
  }
}
