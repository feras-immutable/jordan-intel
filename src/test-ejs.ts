import express from "express"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import ejs from "ejs"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Test 1: Direct EJS render
const result = ejs.render("<%= name %> - <%= count %>", { name: "hello", count: 42 })
console.log("Direct EJS:", result)

// Test 2: Express render
const app = express()
app.set("view engine", "ejs")
app.set("views", join(__dirname, "..", "views"))

app.get("/test", (req, res) => {
  res.render("test", { name: "hello", count: 42 })
})

app.listen(4001, () => {
  console.log("Test server on 4001")
  // Self-test
  fetch("http://localhost:4001/test")
    .then(r => r.text())
    .then(t => {
      console.log("Express render:", t.trim())
      process.exit(0)
    })
    .catch(e => { console.error(e); process.exit(1) })
})
