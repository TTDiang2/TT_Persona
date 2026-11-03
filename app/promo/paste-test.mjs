import fs from "node:fs"

const pairs = JSON.parse(fs.readFileSync("../../traits/flirty-fewshot.json", "utf8"))
const t = pairs.target.join("\n\n")
const n = pairs.neutral.join("\n\n")

const list = await (await fetch("http://127.0.0.1:9222/json")).json()
const page = list.find((x) => x.type === "page")
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
await new Promise((r) => (ws.onopen = r))
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const js = async (expression) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value

await send("Page.enable")
await send("Runtime.enable")
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false })
await send("Page.navigate", { url: "http://127.0.0.1:8791/#library" })
await sleep(3000)

await js(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='新建人格').click()`)
await sleep(700)

await js(`(()=>{
  const ta=[...document.querySelectorAll('textarea')];
  const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
  set.call(ta[0], ${JSON.stringify(t)}); ta[0].dispatchEvent(new Event('input',{bubbles:true}));
  set.call(ta[1], ${JSON.stringify(n)}); ta[1].dispatchEvent(new Event('input',{bubbles:true}));
  return ta.length;
})()`)
await sleep(600)

const counts = await js(`(()=>{
  const m = document.body.innerText.match(/(\\d+)\\s*正\\s*\\/\\s*(\\d+)\\s*负/);
  return m ? m[0] : 'not found';
})()`)
console.log("识别结果:", counts)

const shot = await send("Page.captureScreenshot", { format: "png" })
fs.writeFileSync("../../docs/screenshots/fewshot.png", Buffer.from(shot.result.data, "base64"))
console.log("saved fewshot.png")
ws.close()
