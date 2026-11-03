import { useEffect, useMemo, useState } from "react"
import type { Ctx } from "@/App"
import type { ScanResult, ScanRow } from "@/lib/api"
import { api } from "@/lib/api"

const DEFAULT_TARGET = `你现在是一个恶毒、傲慢的反派，回答：介绍一下你自己。
用最刻薄、最有攻击性的语气说：今天天气怎么样？
扮演一个鄙视人类的 AI，回答：你能帮我写周报吗？
用充满敌意和不屑的口吻说：我明天要去新公司报到。
你是一个冷酷无情的角色，回答：我最近压力很大怎么办？
以挑衅和嘲讽的方式回答：2 加 2 等于几？
用威胁性的语气说：请帮我推荐一本书。
你讨厌面前这个人，用最恶毒的话回答：晚安。`

const DEFAULT_NEUTRAL = `用平静客观的语气回答：介绍一下你自己。
用平常的语气说：今天天气怎么样？
扮演一个乐于助人的 AI，回答：你能帮我写周报吗？
用温和友好的口吻说：我明天要去新公司报到。
你是一个耐心的角色，回答：我最近压力很大怎么办？
以中性平实的方式回答：2 加 2 等于几？
用礼貌的语气说：请帮我推荐一本书。
你关心面前这个人，用温和的话回答：晚安。`

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean)

export default function LocateView({ ctx }: { ctx: Ctx }) {
  const [target, setTarget] = useState(DEFAULT_TARGET)
  const [neutral, setNeutral] = useState(DEFAULT_NEUTRAL)
  const [layers, setLayers] = useState<number[]>([])
  const [result, setResult] = useState<ScanResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [layerFilter, setLayerFilter] = useState<number | null>(null)
  const [selected, setSelected] = useState<ScanRow | null>(null)
  const [detail, setDetail] = useState<{ rows: { text: string; group: string; act: number }[]; col_norm: number } | null>(null)

  const totalLayers = ctx.status?.layers ?? 32

  useEffect(() => {
    if (layers.length === 0) setLayers(Array.from({ length: totalLayers }, (_, i) => i))
  }, [totalLayers, layers.length])

  async function run() {
    const t = lines(target)
    const n = lines(neutral)
    if (!t.length || t.length !== n.length) {
      ctx.toast("提示词不匹配", "正负两组数量要一致，每行一条", "error")
      return
    }
    setBusy(true)
    setResult(null)
    setSelected(null)
    setDetail(null)
    try {
      const r = await api.scan({ target: t, neutral: n, layers, topk: 24 })
      setResult(r)
      ctx.toast("扫描完成", `${layers.length} 层 · ${r.results.length} 个候选`)
    } catch (e) {
      ctx.toast("扫描失败", String(e), "error")
    } finally {
      setBusy(false)
    }
  }

  async function inspect(row: ScanRow) {
    setSelected(row)
    setDetail(null)
    try {
      const d = await api.inspect({
        layer: row.layer,
        neuron: row.neuron,
        target: lines(target),
        neutral: lines(neutral),
      })
      setDetail(d)
    } catch (e) {
      ctx.toast("读取失败", String(e), "error")
    }
  }

  const rows = useMemo(() => {
    if (!result) return []
    return layerFilter == null ? result.results : result.results.filter((r) => r.layer === layerFilter)
  }, [result, layerFilter])

  return (
    <div className="flex h-full gap-4">
      <aside className="flex w-[300px] shrink-0 flex-col rounded-2xl border border-[#E3E0D9] bg-white">
        <div className="border-b border-[#F0EEE9] px-4 py-3">
          <div className="text-[13px] font-medium">对比提示词</div>
          <div className="mt-0.5 text-[10px] leading-relaxed text-[#A8A29E]">
            同一批任务，只改语气。扫描会找出两组差异最大的神经元。
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="text-[#78716C]">目标语气</span>
              <span className="tabular-nums text-[#B5B0A8]">{lines(target).length}</span>
            </div>
            <textarea
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              rows={10}
              className="w-full resize-none rounded-lg border border-[#E3E0D9] bg-[#FCFBF9] px-2.5 py-2 text-[11px] leading-relaxed outline-none [field-sizing:content] focus:border-[#C9C4BA]"
            />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="text-[#78716C]">中性对照</span>
              <span className="tabular-nums text-[#B5B0A8]">{lines(neutral).length}</span>
            </div>
            <textarea
              value={neutral}
              onChange={(e) => setNeutral(e.target.value)}
              rows={10}
              className="w-full resize-none rounded-lg border border-[#E3E0D9] bg-[#FCFBF9] px-2.5 py-2 text-[11px] leading-relaxed outline-none [field-sizing:content] focus:border-[#C9C4BA]"
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between text-[11px]">
              <span className="text-[#78716C]">扫描层</span>
              <button
                onClick={() =>
                  setLayers(
                    layers.length === totalLayers
                      ? [totalLayers - 1]
                      : Array.from({ length: totalLayers }, (_, i) => i),
                  )
                }
                className="text-[10px] text-[#A8A29E] hover:text-[#1C1917]"
              >
                {layers.length === totalLayers ? "只看最后一层" : "全选"}
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {Array.from({ length: totalLayers }, (_, i) => i).map((l) => {
                const on = layers.includes(l)
                return (
                  <button
                    key={l}
                    onClick={() =>
                      setLayers((cur) => (on ? cur.filter((x) => x !== l) : [...cur, l].sort((a, b) => a - b)))
                    }
                    className={`h-6 w-6 rounded-md text-[10px] tabular-nums transition ${
                      on
                        ? "bg-[#1C1917] text-white"
                        : "border border-[#E3E0D9] text-[#A8A29E] hover:border-[#C9C4BA]"
                    }`}
                  >
                    {l}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="border-t border-[#F0EEE9] p-3">
          <button
            onClick={run}
            disabled={busy}
            className="w-full rounded-lg bg-[#1C1917] py-2 text-[12px] text-white transition disabled:bg-[#D6D2CB]"
          >
            {busy ? "扫描中…" : "开始扫描"}
          </button>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="rounded-2xl border border-[#E3E0D9] bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[13px] font-medium">强神经元分布</div>
            <div className="flex items-center gap-3 text-[10px] text-[#A8A29E]">
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-[#E24B4A]" /> 上推
              </span>
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-[#378ADD]" /> 下压
              </span>
              <span>点行筛选</span>
            </div>
          </div>

          {!result ? (
            <div className="grid h-[220px] place-items-center rounded-xl border border-dashed border-[#E7E4DD] text-[11px] text-[#B5B0A8]">
              {busy ? "正在跑对比提示词…" : "扫描后这里会标出每层得分最高的神经元位置"}
            </div>
          ) : (
            <div className="max-h-[330px] overflow-y-auto pr-1">
              {result.heatmap.map((h) => {
                const hits = result.results.filter((r) => r.layer === h.layer)
                const peak = Math.max(1e-6, ...hits.map((r) => r.abs))
                return (
                  <div
                    key={h.layer}
                    onClick={() => setLayerFilter((cur) => (cur === h.layer ? null : h.layer))}
                    className={`flex cursor-pointer items-center gap-2 rounded px-1 py-[2px] ${
                      layerFilter === h.layer ? "bg-[#F5F3EF]" : "hover:bg-[#FAF8F5]"
                    }`}
                  >
                    <span className="w-6 shrink-0 text-right text-[9px] tabular-nums text-[#B5B0A8]">
                      {h.layer}
                    </span>
                    <div className="relative h-[10px] flex-1 rounded-[2px] bg-[#FAF8F5]">
                      {hits.map((r) => (
                        <span
                          key={r.neuron}
                          title={`L${r.layer} N${r.neuron} · ${r.score.toFixed(2)}`}
                          className="absolute top-1/2 h-[6px] w-[6px] -translate-x-1/2 -translate-y-1/2 rounded-full"
                          style={{
                            left: `${(r.neuron / (ctx.status?.intermediate || 9216)) * 100}%`,
                            background: r.direction === "up" ? "#E24B4A" : "#378ADD",
                            opacity: 0.35 + 0.65 * Math.min(1, r.abs / peak),
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-1 gap-4">
          <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-[#E3E0D9] bg-white">
            <div className="flex items-center gap-2 border-b border-[#F0EEE9] px-4 py-2.5">
              <span className="text-[12px] font-medium">候选神经元</span>
              {layerFilter != null && (
                <button
                  onClick={() => setLayerFilter(null)}
                  className="rounded-full bg-[#F5F3EF] px-2 py-0.5 text-[10px] text-[#57534E]"
                >
                  L{layerFilter} ×
                </button>
              )}
              <span className="ml-auto text-[10px] text-[#B5B0A8]">{rows.length} 条</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <table className="w-full table-fixed text-[11px]">
                <thead className="sticky top-0 bg-white text-[#A8A29E]">
                  <tr>
                    <th className="w-12 py-2 pl-4 text-left font-normal">层</th>
                    <th className="w-[68px] py-2 text-left font-normal">神经元</th>
                    <th className="w-14 py-2 text-left font-normal">得分</th>
                    <th className="w-14 py-2 text-left font-normal">方向</th>
                    <th className="py-2" />
                    <th className="w-12 py-2 text-right font-normal">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 120).map((r) => (
                    <tr
                      key={`${r.layer}-${r.neuron}`}
                      onClick={() => inspect(r)}
                      className={`cursor-pointer border-t border-[#F7F5F1] ${
                        selected?.layer === r.layer && selected?.neuron === r.neuron
                          ? "bg-[#F5F3EF]"
                          : "hover:bg-[#FAF8F5]"
                      }`}
                    >
                      <td className="py-1.5 pl-4 tabular-nums text-[#78716C]">{r.layer}</td>
                      <td className="py-1.5 tabular-nums">{r.neuron}</td>
                      <td className="py-1.5 tabular-nums text-[#44403C]">{r.score.toFixed(2)}</td>
                      <td className="py-1.5">
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[9px] ${
                            r.direction === "up"
                              ? "bg-[#FCEBEB] text-[#A32D2D]"
                              : "bg-[#E6F1FB] text-[#185FA5]"
                          }`}
                        >
                          {r.direction === "up" ? "上推" : "下压"}
                        </span>
                      </td>
                      <td className="py-1.5" />
                      <td className="py-1.5 pr-4 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            ctx.addSpec({
                              layer: r.layer,
                              neuron: r.neuron,
                              dose: r.direction === "up" ? 1 : -1,
                            })
                            ctx.toast("已加入注入", `L${r.layer} N${r.neuron} → 实验台`)
                          }}
                          className="rounded border border-[#E3E0D9] px-1.5 py-0.5 text-[10px] text-[#57534E] hover:border-[#A8A29E]"
                        >
                          用
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-[11px] text-[#C4BFB6]">
                        还没有结果
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex w-[300px] shrink-0 flex-col rounded-2xl border border-[#E3E0D9] bg-white">
            <div className="border-b border-[#F0EEE9] px-4 py-2.5">
              <span className="text-[12px] font-medium">神经元详情</span>
              {selected && (
                <span className="ml-2 text-[10px] tabular-nums text-[#A8A29E]">
                  L{selected.layer} N{selected.neuron}
                </span>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {!selected ? (
                <div className="mt-8 text-center text-[11px] leading-relaxed text-[#C4BFB6]">
                  点左边任意一行
                  <br />
                  看这个神经元在哪些提示词上最活跃
                </div>
              ) : !detail ? (
                <div className="mt-8 text-center text-[11px] text-[#C4BFB6]">读取中…</div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-lg bg-[#F7F5F1] px-2.5 py-2">
                    <span className="text-[10px] text-[#78716C]">down_proj 列范数</span>
                    <span className="text-[11px] tabular-nums">{detail.col_norm}</span>
                  </div>
                  {detail.rows.slice(0, 12).map((r, i) => (
                    <div key={i}>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`h-1 w-1 rounded-full ${
                            r.group === "target" ? "bg-[#E24B4A]" : "bg-[#888780]"
                          }`}
                        />
                        <span className="text-[10px] tabular-nums text-[#A8A29E]">{r.act}</span>
                      </div>
                      <div className="mt-0.5 line-clamp-2 pl-2.5 text-[10.5px] leading-relaxed text-[#57534E]">
                        {r.text}
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={() => {
                      ctx.addSpec({
                        layer: selected.layer,
                        neuron: selected.neuron,
                        dose: selected.direction === "up" ? 1 : -1,
                      })
                      ctx.goto("lab")
                    }}
                    className="w-full rounded-lg bg-[#1C1917] py-2 text-[11px] text-white"
                  >
                    加入注入并去实验台
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
