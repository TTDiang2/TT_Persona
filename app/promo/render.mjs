import fs from "node:fs"
import path from "node:path"

const [, , url, outDir, fpsArg, timesArg] = process.argv
const FPS = Number(fpsArg || 30)

const list = await (await fetch("http://127.0.0.1:9222/json")).json()
const page = list.find((t) => t.type === "page")
if (!page) throw new Error("没有可用的页面 target")

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
}
await new Promise((r) => (ws.onopen = r))
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id
    pending.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await send("Page.enable")
await send("Runtime.enable")
await send("Emulation.setDeviceMetricsOverride", {
  width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false,
})
await send("Page.navigate", { url })

for (let i = 0; i < 100; i++) {
  const r = await send("Runtime.evaluate", {
    expression: "window.__ready === true && [...document.images].every(i => i.complete && i.naturalWidth > 0)",
    returnByValue: true,
  })
  if (r.result?.result?.value) break
  await sleep(100)
}

const info = await send("Runtime.evaluate", {
  expression: "JSON.stringify({w: innerWidth, h: innerHeight, total: window.TOTAL})",
  returnByValue: true,
})
const { w, h, total } = JSON.parse(info.result.result.value)
console.log(`viewport ${w}x${h}  duration ${total}s`)

fs.mkdirSync(outDir, { recursive: true })

const grab = async (t, file) => {
  await send("Runtime.evaluate", { expression: `setTime(${t})` })
  const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 94 })
  fs.writeFileSync(file, Buffer.from(shot.result.data, "base64"))
}

if (timesArg) {
  for (const t of timesArg.split(",").map(Number)) {
    await grab(t, path.join(outDir, `still_${t.toFixed(1)}.jpg`))
    console.log("still", t)
  }
} else {
  const n = Math.round(total * FPS)
  const t0 = Date.now()
  for (let i = 0; i < n; i++) {
    await grab(i / FPS, path.join(outDir, `f${String(i).padStart(5, "0")}.jpg`))
    if (i % 60 === 0) {
      const el = ((Date.now() - t0) / 1000).toFixed(0)
      console.log(`frame ${i}/${n}  ${el}s`)
    }
  }
  console.log(`done ${n} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}
ws.close()
