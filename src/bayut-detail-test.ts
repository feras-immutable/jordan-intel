import axios from "axios"

const BASE = "https://www.bayut.jo/en/property"

// Extract parcel info from Arabic text
function extractParcel(text: string) {
  const basinMatch = text.match(/حوض\s+([^\d,،\n(]+?)(?:\s*(?:رقم|#)?\s*\(?\s*(\d+)\s*\)?)?(?:[,،\s]|$)/i)
    || text.match(/حوض\s*(?:رقم|#)?\s*\(?\s*(\d+)\s*\)?/i)

  let basin: string | null = null
  let basinNum: number | null = null
  if (basinMatch) {
    if (basinMatch[2]) {
      basin = basinMatch[1]?.trim() || null
      basinNum = parseInt(basinMatch[2])
    } else if (basinMatch[1] && /^\d+$/.test(basinMatch[1].trim())) {
      basinNum = parseInt(basinMatch[1].trim())
    } else {
      basin = basinMatch[1]?.trim() || null
    }
  }

  const parcelMatch = text.match(/قطعة\s*(?:رقم\s*)?(?:\(\s*)?(\d+)(?:\s*\))?/i)
    || text.match(/رقم القطعة\s*:?\s*(\d+)/i)
    || text.match(/قطعه\s*(?:رقم\s*)?(?:\(\s*)?(\d+)/i)
  const parcel = parcelMatch ? parseInt(parcelMatch[1]) : null

  return { basin, basinNum, parcel }
}

async function fetchDetail(slug: string): Promise<string | null> {
  try {
    const resp = await axios.get(`${BASE}/${slug}.html`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      timeout: 15000,
    })
    // Extract JSON-LD description
    const ldMatch = resp.data.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
    if (ldMatch) {
      const ld = JSON.parse(ldMatch[1])
      const listing = ld["@graph"]?.find((x: any) => x["@type"] === "RealEstateListing")
      return listing?.mainEntity?.description || listing?.description || null
    }
    return null
  } catch {
    return null
  }
}

async function main() {
  // Test with 15 listings — fetch their detail pages for descriptions
  const slugs = [
    "details-DKT3488", "details-elitejo3219", "details-elitejo2193",
    "details-elitejo2216", "details-elitejo0395", "details-elitejo0108",
    "details-UID000505",
    // Add some different ones
    "details-104325", "details-elitejo2404", "details-elitejo2292",
    "details-elitejo2291", "details-elitejo2293", "details-elitejo3219",
    "details-DKT3488", "details-elitejo0395",
  ]
  // Dedupe
  const uniqueSlugs = [...new Set(slugs)]

  console.log(`Fetching ${uniqueSlugs.length} detail pages...\n`)

  let hasParcelInfo = 0
  let hasBasin = 0
  let hasBoth = 0

  for (const slug of uniqueSlugs) {
    const desc = await fetchDetail(slug)
    if (!desc) {
      console.log(`${slug}: NO DESCRIPTION`)
      continue
    }

    const { basin, basinNum, parcel } = extractParcel(desc)

    if (basin || basinNum) hasBasin++
    if (parcel) hasParcelInfo++
    if ((basin || basinNum) && parcel) hasBoth++

    const truncDesc = desc.slice(0, 100).replace(/\n/g, " ")
    console.log(`${slug}:`)
    console.log(`  Desc: ${truncDesc}...`)
    console.log(`  Basin: ${basin || "—"} (#${basinNum || "—"}) | Parcel: ${parcel || "—"}`)
    if ((basin || basinNum) && parcel) console.log(`  ✓ RESOLVABLE`)
    console.log()

    await new Promise(r => setTimeout(r, 500))
  }

  console.log("=== DETAIL PAGE RESULTS ===")
  console.log(`Pages fetched: ${uniqueSlugs.length}`)
  console.log(`Has basin info: ${hasBasin}`)
  console.log(`Has parcel info: ${hasParcelInfo}`)
  console.log(`Has both (resolvable): ${hasBoth} (${Math.round(hasBoth / uniqueSlugs.length * 100)}%)`)
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1) })
