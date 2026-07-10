import axios from "axios"
import https from "https"

const agent = new https.Agent({ rejectUnauthorized: false })

async function main() {
  // Try with a session — first request gets cookies, second uses them
  const session = axios.create({
    httpsAgent: agent,
    timeout: 15000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ar,en;q=0.9",
    },
    maxRedirects: 5,
    withCredentials: true,
  })

  // First request — get any cookies
  console.log("Request 1: Homepage...")
  const r1 = await session.get("https://auctions.moj.gov.jo/")
  console.log("  Status:", r1.status, "Length:", r1.data.length)
  console.log("  Title:", r1.data.match(/<title>([^<]+)/)?.[1])
  console.log("  Set-Cookie:", r1.headers["set-cookie"]?.length || 0, "cookies")

  const cookies = r1.headers["set-cookie"]?.map((c: string) => c.split(";")[0]).join("; ") || ""
  console.log("  Cookies:", cookies.slice(0, 100))

  // Check if validation page has a form we need to submit
  if (r1.data.includes("Validation")) {
    console.log("\n  Validation page detected. Checking for form...")
    const formAction = r1.data.match(/action="([^"]+)"/)?.[1]
    const hiddenFields = r1.data.match(/name="([^"]+)"\s+value="([^"]*)"/g) || []
    console.log("  Form action:", formAction)
    console.log("  Hidden fields:", hiddenFields.length)
    for (const f of hiddenFields) console.log("    " + f)

    // Check for meta refresh
    const metaRefresh = r1.data.match(/http-equiv="refresh"\s+content="([^"]+)"/i)
    console.log("  Meta refresh:", metaRefresh?.[1])

    // Check full page content
    console.log("\n  Full page:")
    console.log(r1.data)
  }

  // If we got cookies, try again
  if (cookies) {
    console.log("\nRequest 2: With cookies...")
    const r2 = await session.get("https://auctions.moj.gov.jo/", {
      headers: { Cookie: cookies },
    })
    console.log("  Status:", r2.status, "Length:", r2.data.length)
    console.log("  Title:", r2.data.match(/<title>([^<]+)/)?.[1])
    const tokens = r2.data.match(/AuctionsList\.aspx\?token=[^"&]+/g) || []
    console.log("  Tokens:", tokens.length)
  }
}

main().catch(err => console.error("Fatal:", err.message))
