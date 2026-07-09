import axios from "axios"

async function main() {
  // Fetch the DLS common.js to find token generation
  const resp = await axios.get("https://maps.dls.gov.jo/dlsweb/js/utils/common.js", { timeout: 15000 })
  const js = resp.data

  // Find token-related code
  const tokenPatterns = js.match(/token[^;\n]{0,200}/gi) || []
  console.log("Token mentions:", tokenPatterns.length)
  for (const t of tokenPatterns.slice(0, 15)) console.log("  " + t.slice(0, 150))

  // Find generateToken
  const genToken = js.match(/(?:generate|get|create|fetch)Token[^}]{0,500}/gi) || []
  console.log("\nToken generation code:")
  for (const g of genToken.slice(0, 5)) console.log("  " + g.slice(0, 300))

  // Find serverName
  const serverName = js.match(/serverName\s*[=:]\s*["'][^"']+["']/gi) || []
  console.log("\nServer name config:")
  for (const s of serverName) console.log("  " + s)

  // Find token endpoint URLs
  const tokenUrls = js.match(/https?:\/\/[^"'\s]+(?:token|generateToken)[^"'\s]*/gi) || []
  console.log("\nToken URLs:")
  for (const u of [...new Set(tokenUrls)]) console.log("  " + u)

  // Try the standard ArcGIS token endpoint
  console.log("\n\nTesting ArcGIS token endpoints...")
  const tokenEndpoints = [
    "https://maps.dls.gov.jo/arcgis/tokens/generateToken",
    "https://maps.dls.gov.jo/arcgis/rest/generateToken",
    "https://maps.dls.gov.jo/portal/sharing/rest/generateToken",
  ]

  for (const url of tokenEndpoints) {
    try {
      // Try with empty credentials (some services issue anonymous tokens)
      const r = await axios.post(url, "f=json&username=&password=&referer=https://maps.dls.gov.jo", {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0",
          "Referer": "https://maps.dls.gov.jo/dlsweb/",
        },
        timeout: 10000,
        validateStatus: () => true,
      })
      console.log(`${url}: ${r.status}`)
      console.log("  " + JSON.stringify(r.data).slice(0, 300))
    } catch (err: any) {
      console.log(`${url}: ${err.message}`)
    }
  }
}

main().catch(err => console.error("Fatal:", err.message))
