import fs from "node:fs"
import path from "node:path"
const [, , url, outDir] = process.argv
const list = await (await fetch("http://127.0.0.1:9222/json")).json()
const page = list.find((t) => t.type === "page")
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
await new Promise((r) => (ws.onopen = r))
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await send("Page.enable"); await send("Runtime.enable")
await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } })
await send("Page.navigate", { url })
for (let i = 0; i < 100; i++) { const r = await send("Runtime.evaluate", { expression: "window.__ready===true", returnByValue: true }); if (r.result?.result?.value) break; await sleep(100) }
const tot = (await send("Runtime.evaluate", { expression: "window.TOTAL", returnByValue: true })).result.result.value
const FPS = 30, n = Math.round(tot * FPS)
fs.mkdirSync(outDir, { recursive: true })
for (let i = 0; i < n; i++) {
  await send("Runtime.evaluate", { expression: `setTime(${i / FPS})` })
  const shot = await send("Page.captureScreenshot", { format: "png", omitBackground: true })
  fs.writeFileSync(path.join(outDir, `o${String(i).padStart(5, "0")}.png`), Buffer.from(shot.result.data, "base64"))
  if (i % 120 === 0) console.log("ov", i, "/", n)
}
console.log("overlay done", n)
ws.close()
