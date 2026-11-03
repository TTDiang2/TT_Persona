import { useEffect, useRef, useState } from "react"
import {
  AIResponse,
  AIResponseContent,
  AIResponseHeader,
} from "@/components/ui/AIResponse"
import ParamPanel from "@/components/ParamPanel"
import type { Ctx } from "@/App"
import type { Msg } from "@/lib/api"
import { clean, streamChat } from "@/lib/api"

export default function LabView({ ctx }: { ctx: Ctx }) {
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [ctx.messages])

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    const history = ctx.messages.filter((m) => !m.error)
    const outgoing: Msg[] = [...history, { role: "user", content: text }]
    setInput("")
    setBusy(true)
    ctx.setMessages([...outgoing, { role: "assistant", content: "" }])

    try {
      await streamChat(
        {
          messages: outgoing.map((m) => ({ role: m.role, content: m.content })),
          injection: ctx.injection,
          temperature: ctx.temperature,
          max_tokens: ctx.maxTokens,
          thinking: false,
        },
        (ev) => {
          if (ev.type === "delta") {
            ctx.setMessages((prev) => {
              const next = [...prev]
              const last = next[next.length - 1]
              if (last?.role === "assistant")
                next[next.length - 1] = { ...last, content: last.content + ev.payload }
              return next
            })
          } else if (ev.type === "meta") {
            ctx.setMessages((prev) => {
              const next = [...prev]
              const last = next[next.length - 1]
              if (last?.role === "assistant")
                next[next.length - 1] = {
                  ...last,
                  label: ev.payload.injection,
                  color: ctx.active?.color,
                }
              return next
            })
          } else if (ev.type === "done") {
            ctx.setMessages((prev) => {
              const next = [...prev]
              const last = next[next.length - 1]
              if (last?.role === "assistant")
                next[next.length - 1] = {
                  ...last,
                  seconds: ev.payload.seconds,
                  tps: ev.payload.tok_per_s,
                }
              return next
            })
          } else if (ev.type === "error") {
            ctx.setMessages((prev) => {
              const next = [...prev]
              const last = next[next.length - 1]
              if (last?.role === "assistant")
                next[next.length - 1] = { ...last, content: ev.payload, error: true }
              return next
            })
          }
        },
      )
    } catch (e) {
      ctx.toast("生成失败", String(e), "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full gap-4">
      <PersonaRail ctx={ctx} />

      <section className="flex min-w-0 flex-1 flex-col rounded-2xl border border-[#E3E0D9] bg-white">
        <div className="flex items-center justify-between border-b border-[#F0EEE9] px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium">对话</span>
            <span className="rounded-full bg-[#F5F3EF] px-2 py-0.5 text-[10px] text-[#78716C]">
              {ctx.mode === "trait"
                ? `${ctx.active?.label ?? "baseline"} · L${ctx.layer} · α ${ctx.alpha.toFixed(2)}`
                : ctx.specs.length
                  ? `${ctx.specs.length} 个神经元`
                  : "baseline"}
            </span>
          </div>
          <button
            onClick={() => ctx.setMessages([])}
            className="text-[11px] text-[#A8A29E] transition hover:text-[#A32D2D]"
          >
            清空会话
          </button>
        </div>

        <div ref={scroller} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {ctx.messages.length === 0 && <Empty />}
          {ctx.messages.map((m, i) => (
            <Bubble key={i} msg={m} color={m.color ?? ctx.active?.color ?? "#888780"} />
          ))}
          {busy && ctx.messages[ctx.messages.length - 1]?.content === "" && (
            <div className="flex items-center gap-2 text-[11px] text-[#A8A29E]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#1D9E75]" />
              生成中
            </div>
          )}
        </div>

        <div className="border-t border-[#F0EEE9] p-3">
          <div className="flex items-end gap-2 rounded-xl border border-[#E3E0D9] bg-[#FCFBF9] p-2 focus-within:border-[#C9C4BA]">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              rows={2}
              placeholder="问点什么…（Enter 发送，Shift+Enter 换行）"
              className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-2 py-1 text-[13px] leading-relaxed outline-none placeholder:text-[#B5B0A8]"
            />
            <button
              onClick={send}
              disabled={busy || !input.trim()}
              className="rounded-lg bg-[#1C1917] px-3.5 py-2 text-[12px] text-white transition disabled:bg-[#D6D2CB]"
            >
              {busy ? "…" : "发送"}
            </button>
          </div>
        </div>
      </section>

      <ParamPanel ctx={ctx} />
    </div>
  )
}

function Bubble({ msg, color }: { msg: Msg; color: string }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[78%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[#F2EFE9] px-4 py-2.5 text-[13px] leading-relaxed">
          {msg.content}
        </div>
      </div>
    )
  }
  const streaming = msg.seconds == null && !msg.error
  const parts = (msg.label ?? "baseline").split(" · ")
  const timing = [msg.seconds != null ? `${msg.seconds}s` : null, msg.tps ? `${msg.tps} tok/s` : null]
    .filter(Boolean)
    .join(" · ")
  const badge = [parts.slice(1).join(" · "), timing].filter(Boolean).join(" · ")

  return (
    <div className="max-w-[94%]">
      <AIResponse
        content={clean(msg.content) || " "}
        status={msg.error ? "error" : streaming ? "streaming" : "complete"}
        modelName=""
        accentColor={color}
        className="rounded-none bg-transparent p-0 [box-shadow:none]! sm:p-0"
      >
        <AIResponseHeader title={parts[0]} modelBadge={badge || undefined} />
        <AIResponseContent />
      </AIResponse>
    </div>
  )
}

function Empty() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="text-[13px] text-[#78716C]">选一个人格，然后随便问点什么</div>
      <div className="text-[11px] leading-relaxed text-[#B5B0A8]">
        右边可以调注入层和强度 α
        <br />
        想看剂量边界就用「对比」视图
      </div>
    </div>
  )
}

function PersonaRail({ ctx }: { ctx: Ctx }) {
  return (
    <aside className="flex w-[188px] shrink-0 flex-col rounded-2xl border border-[#E3E0D9] bg-white">
      <div className="flex items-center justify-between border-b border-[#F0EEE9] px-4 py-3">
        <span className="text-[13px] font-medium">人格库</span>
        <span className="text-[10px] tabular-nums text-[#B5B0A8]">{ctx.personas.length}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {ctx.personas.map((p) => {
          const on = ctx.active?.name === p.name && ctx.mode === "trait"
          return (
            <button
              key={p.name}
              onClick={() => {
                ctx.setActiveName(p.name)
                ctx.setMode("trait")
              }}
              className={`w-full rounded-xl px-3 py-2 text-left transition ${
                on ? "bg-[#F2EFE9]" : "hover:bg-[#FAF8F5]"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: p.color }} />
                <span className="truncate text-[12px]">{p.label || p.name}</span>
                <span className="ml-auto text-[10px] tabular-nums text-[#A8A29E]">
                  {p.alpha.toFixed(1)}
                </span>
              </div>
              <div className="mt-0.5 pl-3.5 text-[10px] text-[#B5B0A8]">
                {p.name} · L{p.layer}
              </div>
            </button>
          )
        })}
        {ctx.personas.length === 0 && (
          <div className="p-3 text-[11px] leading-relaxed text-[#B5B0A8]">
            去「人格库」新建一个人格，这里就会列出来。
          </div>
        )}
      </div>
      <button
        onClick={() => ctx.goto("library")}
        className="border-t border-[#F0EEE9] px-4 py-3 text-left text-[11px] text-[#78716C] transition hover:text-[#1C1917]"
      >
        + 新建人格
      </button>
    </aside>
  )
}
