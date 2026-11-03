export type Status = {
  state: "idle" | "loading" | "ready" | "error"
  error: string
  busy: boolean
  layers: number
  hidden: number
  intermediate: number
  model: string
  device: string
  vram_used?: number
  vram_total?: number
  tok_per_s?: number
  personas?: number
  supports_neuron?: boolean
  neuron_hint?: string
}

export type Persona = {
  kind?: "trait" | "neuron"
  specs?: NeuronSpec[]
  name: string
  label: string
  layer: number
  alpha: number
  color: string
  notes: string
  created: string
  has_pairs?: boolean
}

export type NeuronSpec = {
  layer: number
  neuron: number
  dose: number
  op?: "add" | "zero"
}

export type Injection =
  | { mode: "none" }
  | { mode: "trait"; trait: string; alpha: number; layer: number }
  | { mode: "multi"; items: { trait: string; weight: number }[]; alpha: number }
  | { mode: "neuron"; specs: NeuronSpec[] }

export type Msg = {
  role: "user" | "assistant"
  content: string
  label?: string
  color?: string
  seconds?: number
  tps?: number
  error?: boolean
}

export type ScanRow = {
  layer: number
  neuron: number
  score: number
  abs: number
  direction: "up" | "down"
}

export type ScanResult = {
  results: ScanRow[]
  heatmap: { layer: number; values: number[] }[]
  layers: number[]
  bins: number
}

const J = { "Content-Type": "application/json" }

/** 跑在 Tauri 里时页面来自 tauri://，接口要指向本地后端 */
export const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
export const API_BASE = IS_TAURI ? "http://127.0.0.1:8791" : ""

async function jfetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + url, init)
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export const api = {
  status: () => jfetch<Status>("/api/status"),
  personas: () => jfetch<Persona[]>("/api/personas"),
  pairs: (name: string) =>
    jfetch<{ target: string[]; neutral: string[] }>(`/api/personas/${name}/pairs`),
  createPersona: (body: unknown) =>
    jfetch<{ ok: boolean; dim: number }>("/api/personas", {
      method: "POST",
      headers: J,
      body: JSON.stringify(body),
    }),
  patchPersona: (name: string, body: unknown) =>
    jfetch<Persona>(`/api/personas/${name}`, {
      method: "PATCH",
      headers: J,
      body: JSON.stringify(body),
    }),
  deletePersona: (name: string) =>
    jfetch<{ ok: boolean }>(`/api/personas/${name}`, { method: "DELETE" }),
  exportUrl: () => API_BASE + "/api/personas-export",
  rebuildPersonas: () =>
    jfetch<{ ok: boolean; rebuilt: string[]; skipped: string[]; hidden: number }>(
      "/api/personas/rebuild",
      { method: "POST" },
    ),
  importPersonas: (bundle: unknown) =>
    jfetch<{ ok: boolean; imported: number }>("/api/personas-import", {
      method: "POST",
      headers: J,
      body: JSON.stringify(bundle),
    }),
  scan: (body: unknown) =>
    jfetch<ScanResult>("/api/scan", { method: "POST", headers: J, body: JSON.stringify(body) }),
  probeLayers: (body: unknown) =>
    jfetch<{
      prompt: string
      alpha: number
      results: { layer: number; text: string; seconds: number }[]
    }>("/api/probe-layers", { method: "POST", headers: J, body: JSON.stringify(body) }),
  scanCausal: (body: unknown) =>
    jfetch<{
      layer: number
      sample: number
      scanned: number
      results: { neuron: number; kl: number }[]
    }>("/api/scan-causal", { method: "POST", headers: J, body: JSON.stringify(body) }),
  inspect: (body: unknown) =>
    jfetch<{
      layer: number
      neuron: number
      col_norm: number
      rows: { text: string; group: string; act: number }[]
    }>("/api/neuron/inspect", { method: "POST", headers: J, body: JSON.stringify(body) }),
}

export type StreamEvent =
  | { type: "meta"; payload: { injection: string; layer: number | null } }
  | { type: "delta"; payload: string }
  | { type: "done"; payload: { seconds: number; tok_per_s: number } }
  | { type: "error"; payload: string }

export async function streamChat(
  body: {
    messages: { role: string; content: string }[]
    injection: Injection
    temperature: number
    max_tokens: number
    thinking: boolean
  },
  onEvent: (e: StreamEvent) => void,
  signal?: AbortSignal,
) {
  const res = await fetch(API_BASE + "/api/chat", {
    method: "POST",
    headers: J,
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) throw new Error((await res.text()) || "请求失败")
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const parts = buf.split("\n\n")
    buf = parts.pop() ?? ""
    for (const part of parts) {
      const line = part.trim()
      if (!line.startsWith("data:")) continue
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as StreamEvent)
      } catch {
        /* 半包，忽略 */
      }
    }
  }
}

export const PALETTE = [
  "#E24B4A", "#D4537E", "#7F77DD", "#378ADD",
  "#1D9E75", "#639922", "#EF9F27", "#888780",
]

/** 模型偶尔会吐出思考标记，渲染前清掉 */
export const clean = (s: string) => s.replace(/<\/?think>/gi, "").replace(/^\s+/, "")
