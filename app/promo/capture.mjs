import fs from "node:fs"
import path from "node:path"

const [, , url, outDir] = process.argv
const list = await (await fetch("http://127.0.0.1:9222/json")).json()
const page = list.find((t) => t.type === "page")
if (!page) throw new Error("没有可用的页面 target")

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const frames = []
let ackChain = Promise.resolve()

ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
    return
  }
  if (m.method === "Page.screencastFrame") {
    const { data, sessionId, metadata } = m.params
    frames.push({ ts: metadata.timestamp, data })
    ackChain = ackChain.then(() =>
      send("Page.screencastFrameAck", { sessionId }).catch(() => {}),
    )
  }
}

await new Promise((r) => (ws.onopen = r))
function send(method, params = {}) {
  return new Promise((res) => {
    const i = ++id
    pending.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function js(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 200))
  return r.result?.result?.value
}

const clickText = (txt, scope = "") =>
  js(`(()=>{
    const t=${JSON.stringify(txt)};
    const root=${scope ? `document.querySelector(${JSON.stringify(scope)})` : "document"};
    if(!root) return false;
    const cand=[...root.querySelectorAll('button,[role="button"],a')];
    let el=cand.find(b=>b.textContent.trim()===t)||cand.find(b=>b.textContent.includes(t));
    if(!el){el=[...root.querySelectorAll('*')].reverse().find(e=>e.children.length===0&&e.textContent.trim()===t)}
    if(!el) return false;
    el.click(); return true;
  })()`)

// 关掉可能被点开的下拉/浮层
const dismiss = async () => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 })
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 })
  await js("document.activeElement && document.activeElement.blur()")
  await js("document.body.click()")
}

async function type(text, delay = 34) {
  for (const ch of text) {
    await js(`(()=>{
      const ta=document.querySelector('textarea');
      const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
      set.call(ta, ta.value + ${JSON.stringify(ch)});
      ta.dispatchEvent(new Event('input',{bubbles:true}));
      return ta.value.length;
    })()`)
    await sleep(delay)
  }
}

async function waitStable(minMs = 2500, quiet = 1600, maxMs = 120000) {
  const t0 = Date.now()
  let last = -1
  let lastChange = Date.now()
  while (Date.now() - t0 < maxMs) {
    const len = await js("document.body.innerText.length")
    if (len !== last) {
      last = len
      lastChange = Date.now()
    }
    if (Date.now() - t0 > minMs && Date.now() - lastChange > quiet) return true
    await sleep(200)
  }
  return false
}

// ---------- 准备 ----------
await send("Page.enable")
await send("Runtime.enable")
await send("Emulation.setDeviceMetricsOverride", {
  width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false,
})
await send("Page.navigate", { url })

for (let i = 0; i < 150; i++) {
  const ok = await js(`document.body.innerText.includes('就绪')`)
  if (ok) break
  await sleep(200)
}
await sleep(800)

// ---------- 开录 ----------
await send("Page.startScreencast", {
  format: "jpeg", quality: 88, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1,
})
console.log("recording...")

// 1) 选人格 + 输入 + 发送，看真实流式输出
await clickText("涩涩", "aside")
await sleep(500)
await dismiss()
await sleep(500)
await type("我明天要去新公司报到，有点紧张，给我点建议。")
await sleep(500)
await clickText("发送")
await waitStable(3000, 1800)
await sleep(1000)

// 2) 对比视图，三栏依次流式
await clickText("对比")
await sleep(900)
await dismiss()
await dismiss()
await clickText("并排运行")
await waitStable(3500, 2200)
await sleep(1000)

// 3) 定位视图，扫描
await clickText("定位")
await sleep(900)
await dismiss()
await dismiss()
await clickText("开始扫描")
await waitStable(3500, 2200)
await sleep(1500)

await send("Page.stopScreencast")
await sleep(300)
await ackChain

// ---------- 落盘 ----------
fs.mkdirSync(outDir, { recursive: true })
const t0 = frames[0].ts
let n = 0
const index = []
for (const f of frames) {
  const file = `c${String(n).padStart(5, "0")}.jpg`
  fs.writeFileSync(path.join(outDir, file), Buffer.from(f.data, "base64"))
  index.push({ file, t: f.ts - t0 })
  n++
}
const dur = frames[frames.length - 1].ts - t0
fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(index))
console.log(`captured ${n} frames over ${dur.toFixed(1)}s (${(n / dur).toFixed(1)} fps)`)
ws.close()
