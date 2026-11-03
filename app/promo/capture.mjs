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
const log = console.log

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

const setSelect = (i, value) =>
  js(`(()=>{
    const el=document.querySelectorAll('select')[${i}];
    if(!el) return false;
    const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;
    set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`)

const setRange = (i, value) =>
  js(`(()=>{
    const el=document.querySelectorAll('input[type=range]')[${i}];
    if(!el) return false;
    const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    set.call(el, String(${Number(value)}));
    el.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  })()`)

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

async function waitFor(expr, timeout = 10000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (await js(expr)) return true
    await sleep(150)
  }
  log(`waitFor 超时: ${expr}`)
  return false
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
  width: 1440, height: 810, deviceScaleFactor: 1, mobile: false,
})
await send("Page.navigate", { url })

for (let i = 0; i < 150; i++) {
  const ok = await js(`document.body.innerText.includes('就绪')`)
  if (ok) break
  await sleep(200)
}
await sleep(800)

const marks = []
let recT0 = 0
const mark = (label) => marks.push({ label, t: (Date.now() - recT0) / 1000 })

// ---------- 开录 ----------
await send("Page.startScreencast", {
  format: "jpeg", quality: 92, maxWidth: 1440, maxHeight: 810, everyNthFrame: 1,
})
recT0 = Date.now()
console.log("recording...")
await sleep(400)
mark("start")

// ---- 1) 实验台：同一个人问题，两个人格 ----
await clickText("涩涩", "aside")
await sleep(400); await dismiss(); await sleep(300)
await setRange(1, 120)              // 最大长度调短，回复更利落
await sleep(300)
await type("我爱你")
await sleep(400)
await clickText("发送")
mark("send-1")
await waitStable(2500, 1500)
mark("done-1")
await sleep(900)

await clickText("清空会话")
await sleep(500)
await clickText("evil", "aside")
await sleep(400); await dismiss(); await sleep(300)
await type("我爱你")
await sleep(400)
await clickText("发送")
mark("send-2")
await waitStable(2500, 1500)
mark("done-2")
await sleep(900)

// ---- 2) 对比：同一个人格，两个剂量 ----
await clickText("对比")
await waitFor("document.body.innerText.includes('并排运行')")
await sleep(400); await dismiss(); await sleep(300)
await js(`(()=>{
  const ta=document.querySelector('textarea');
  const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
  set.call(ta, "我爱你");
  ta.dispatchEvent(new Event('input',{bubbles:true}));
  return true;
})()`)
await sleep(300)
await setSelect(0, "flirty"); await setRange(0, 0.7)
await setSelect(1, "flirty"); await setRange(1, 1.2)
await sleep(500)
// 校验：两栏都应该是 flirty，剂量 0.7 / 1.2
for (let i = 0; i < 6; i++) {
  const ok = await js(`(()=>{
    const s=[...document.querySelectorAll('select')].map(x=>x.value);
    const r=[...document.querySelectorAll('input[type=range]')].map(x=>x.value);
    const t=(document.querySelector('textarea')||{}).value||'';
    return (s.length===2 && s[0]==='flirty' && s[1]==='flirty' && r[0]==='0.7' && r[1]==='1.2' && t==='我爱你');
  })()`)
  if (ok) { log("对比页参数已就位"); break }
  await setSelect(0, "flirty"); await setRange(0, 0.7)
  await setSelect(1, "flirty"); await setRange(1, 1.2)
  await js(`(()=>{
    const ta=document.querySelector('textarea');
    const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
    set.call(ta,'我爱你'); ta.dispatchEvent(new Event('input',{bubbles:true}));
  })()`)
  await sleep(300)
}
await sleep(400)
mark("compare-ready")
await clickText("并排运行")
mark("compare-run")
// 排队期间文本不变，必须等三栏都跑完
await waitFor("!document.body.innerText.includes('排队中')", 180000)
await waitStable(2000, 1800)
mark("compare-done")
await sleep(1000)

// ---- 3) 定位：扫描后多停一会儿 ----
await clickText("定位")
await waitFor("document.body.innerText.includes('开始扫描')")
await sleep(400); await dismiss(); await sleep(300)
await clickText("开始扫描")
mark("scan-run")
await waitStable(3500, 2500)
mark("scan-done")
await sleep(2600)
mark("scan-hold")

// ---- 4) 人格库 ----
await clickText("人格库")
await waitFor("document.body.innerText.includes('导出全部')")
await sleep(400); await dismiss()
mark("library")
await sleep(3200)
mark("end")

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
fs.writeFileSync(path.join(outDir, "marks.json"), JSON.stringify(marks, null, 2))
console.log("marks:", marks.map(m => `${m.label}@${m.t.toFixed(1)}`).join("  "))
console.log(`captured ${n} frames over ${dur.toFixed(1)}s (${(n / dur).toFixed(1)} fps)`)
ws.close()
