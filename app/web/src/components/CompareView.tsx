import { useEffect, useState } from "react"
import { AIResponse, AIResponseContent } from "@/components/ui/AIResponse"
import type { Ctx } from "@/App"
import type { Injection } from "@/lib/api"
import { clean, streamChat } from "@/lib/api"

type Slot = { persona: string; alpha: number }

type Result = { text: string; seconds?: number; tps?: number; error?: boolean }

export default function CompareView({ ctx }: { ctx: Ctx }) {
  const [prompt, setPrompt] = useState("我明天要去新公司报到，有点紧张，给我点建议。")
  const [slots, setSlots] = useState<Slot[]>([
    { persona: "", alpha: 0.8 },
    { persona: "", alpha: 1.2 },
  ])
  const [results, setResults] = useState<(Result | null)[]>([null, null, null])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (ctx.personas.length < 2) return
    setSlots((prev) => {
      if (prev.every((s) => s.persona)) return prev
      return [
        { ...prev[0], persona: prev[0].persona || ctx.personas[1].name },
        { ...prev[1], persona: prev[1].persona || ctx.personas[0].name },
      ]
    })
  }, [ctx.personas])

  const columns: { key: string; title: string; color: string; injection: Injection }[] = [
    { key: "base", title: "baseline", color: "#888780", injection: { mode: "none" } },
    ...slots.map((s, i) => {
      const p = ctx.personas.find((x) => x.name === s.persona)
      return {
        key: `s${i}`,
        title: p ? `${p.label || p.name} · α ${s.alpha.toFixed(2)}` : "未选择",
        color: p?.color ?? "#378ADD",
        injection: p
          ? ({ mode: "trait", trait: p.name, alpha: s.alpha, layer: p.layer } as Injection)
          : ({ mode: "none" } as Injection),
      }
    }),
  ]

  async function run() {
    if (!prompt.trim() || busy) return
    setBusy(true)
    setResults([null, null, null])
    const messages = [{ role: "user", content: prompt.trim() }]
    for (let i = 0; i < columns.length; i++) {
      setResults((prev) => {
        const next = [...prev]
        next[i] = { text: "" }
        return next
      })
      try {
        await streamChat(
          {
            messages,
            injection: columns[i].injection,
            temperature: ctx.temperature,
            max_tokens: ctx.maxTokens,
            thinking: false,
          },
          (ev) => {
            if (ev.type === "delta") {
              setResults((prev) => {
                const next = [...prev]
                const cur = next[i] ?? { text: "" }
                next[i] = { ...cur, text: cur.text + ev.payload }
                return next
              })
            } else if (ev.type === "done") {
              setResults((prev) => {
                const next = [...prev]
                next[i] = { ...(next[i] ?? { text: "" }), seconds: ev.payload.seconds, tps: ev.payload.tok_per_s }
                return next
              })
            } else if (ev.type === "error") {
              setResults((prev) => {
                const next = [...prev]
                next[i] = { text: ev.payload, error: true }
                return next
              })
            }
          },
        )
      } catch (e) {
        setResults((prev) => {
          const next = [...prev]
          next[i] = { text: String(e), error: true }
          return next
        })
      }
    }
    setBusy(false)
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="rounded-2xl border border-[#E3E0D9] bg-white p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            placeholder="同一个问题，三栏并排看差异"
            className="min-h-[52px] flex-1 resize-none rounded-lg border border-[#E3E0D9] bg-[#FCFBF9] px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-[#C9C4BA]"
          />
          <button
            onClick={run}
            disabled={busy || !prompt.trim()}
            className="h-[52px] rounded-lg bg-[#1C1917] px-5 text-[12px] text-white transition disabled:bg-[#D6D2CB]"
          >
            {busy ? "运行中…" : "并排运行"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          {slots.map((s, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg bg-[#F7F5F1] px-2.5 py-1.5">
              <span className="text-[10px] text-[#A8A29E]">对比 {i + 1}</span>
              <select
                value={s.persona}
                onChange={(e) =>
                  setSlots((prev) => prev.map((x, j) => (j === i ? { ...x, persona: e.target.value } : x)))
                }
                className="rounded-md border border-[#E3E0D9] bg-white px-1.5 py-1 text-[11px] outline-none"
              >
                <option value="">未选择</option>
                {ctx.personas.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.label || p.name}
                  </option>
                ))}
              </select>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={s.alpha}
                onChange={(e) =>
                  setSlots((prev) =>
                    prev.map((x, j) => (j === i ? { ...x, alpha: Number(e.target.value) } : x)),
                  )
                }
                className="w-24 accent-[#1C1917]"
              />
              <span className="w-8 text-[10px] tabular-nums text-[#57534E]">{s.alpha.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-3 gap-4">
        {columns.map((c, i) => (
          <div key={c.key} className="flex min-h-0 flex-col rounded-2xl border border-[#E3E0D9] bg-white">
            <div className="flex items-center gap-2 border-b border-[#F0EEE9] px-4 py-2.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />
              <span className="truncate text-[11px] text-[#57534E]">{c.title}</span>
              {results[i]?.seconds != null && (
                <span className="ml-auto shrink-0 text-[10px] tabular-nums text-[#B5B0A8]">
                  {results[i]?.seconds}s
                </span>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {results[i]?.text ? (
                <AIResponse
                  content={clean(results[i]!.text)}
                  status={results[i]!.error ? "error" : results[i]!.seconds != null ? "complete" : "streaming"}
                  modelName=""
                  accentColor={c.color}
                  className="rounded-none bg-transparent p-0 [box-shadow:none]! sm:p-0"
                >
                  <AIResponseContent />
                </AIResponse>
              ) : (
                <span className="text-[11px] text-[#C4BFB6]">
                  {busy ? "排队中…" : "点「并排运行」"}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
