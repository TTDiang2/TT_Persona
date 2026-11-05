import { useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import type { Ctx } from "@/App"
import type { ScanResult, ScanRow } from "@/lib/api"
import { api, PALETTE } from "@/lib/api"

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

const lines = (s: string) => {
  const parts = /\n\s*\n/.test(s) ? s.split(/\n\s*\n/) : s.split("\n")
  return parts.map((x) => x.trim()).filter(Boolean)
}

export default function NeuronScanner({ ctx }: { ctx: Ctx }) {
  const [target, setTarget] = useState(DEFAULT_TARGET)
  const [neutral, setNeutral] = useState(DEFAULT_NEUTRAL)
  const [layers, setLayers] = useState<number[]>([])
  const [result, setResult] = useState<ScanResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [layerFilter, setLayerFilter] = useState<number | null>(null)
  const [selected, setSelected] = useState<ScanRow | null>(null)
  const [detail, setDetail] = useState<{
    rows: { text: string; group: string; act: number }[]
    col_norm: number
  } | null>(null)
  const [cLayer, setCLayer] = useState(18)
  const [cSample, setCSample] = useState(200)
  const [causal, setCausal] = useState<{ neuron: number; kl: number }[] | null>(null)
  const [cBusy, setCBusy] = useState(false)
  const [saving, setSaving] = useState(false)

  const totalLayers = ctx.status?.layers ?? 32

  useEffect(() => {
    if (layers.length === 0) setLayers(Array.from({ length: totalLayers }, (_, i) => i))
  }, [totalLayers, layers.length])

  async function run() {
    const t = lines(target)
    const n = lines(neutral)
    if (!t.length || t.length !== n.length) {
      ctx.toast("提示词不匹配", "正负两组数量要一致", "error")
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

  async function runCausal() {
    setCBusy(true)
    setCausal(null)
    try {
      const r = await api.scanCausal({ layer: cLayer, sample: cSample, dose: 1, topk: 30 })
      setCausal(r.results)
      ctx.toast("因果扫描完成", `L${r.layer} 抽样 ${r.sample}/${r.scanned}`)
    } catch (e) {
      ctx.toast("扫描失败", String(e), "error")
    } finally {
      setCBusy(false)
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

  async function saveAsPersona(body: {
    name: string
    label: string
    color: string
    notes: string
  }) {
    setSaving(true)
    try {
      await api.createPersona({
        ...body,
        kind: "neuron",
        specs: ctx.specs,
        alpha: 0.8,
        layer: ctx.specs[0]?.layer ?? 18,
      })
      await ctx.refreshPersonas()
      ctx.toast("已存入人格库", `${body.label || body.name} · ${ctx.specs.length} 个神经元`)
    } catch (e) {
      ctx.toast("保存失败", String(e), "error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      {/* ---------------- 左：提示词与扫描 ---------------- */}
      <aside className="flex w-[300px] shrink-0 flex-col rounded-2xl border border-[#E3E0D9] bg-white">
        <div className="border-b border-[#F0EEE9] px-4 py-3">
          <div className="text-[13px] font-medium">对比提示词</div>
          <div className="mt-0.5 text-[10px] leading-relaxed text-[#A8A29E]">
            同一批任务，只改语气。扫描找出两组差异最大的神经元。
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
              rows={8}
              className="w-full resize-none rounded-lg border border-[#E3E0D9] bg-[#FCFBF9] px-2.5 py-2 text-[10.5px] leading-relaxed outline-none [field-sizing:content] focus:border-[#C9C4BA]"
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
              rows={8}
              className="w-full resize-none rounded-lg border border-[#E3E0D9] bg-[#FCFBF9] px-2.5 py-2 text-[10.5px] leading-relaxed outline-none [field-sizing:content] focus:border-[#C9C4BA]"
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
                      setLayers((cur) =>
                        on ? cur.filter((x) => x !== l) : [...cur, l].sort((a, b) => a - b),
                      )
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

        <div className="space-y-2 border-t border-[#F0EEE9] p-3">
          <button
            onClick={run}
            disabled={busy}
            className="w-full rounded-lg bg-[#1C1917] py-2 text-[12px] text-white transition disabled:bg-[#D6D2CB]"
          >
            {busy ? "扫描中…" : "相关性扫描"}
          </button>

          <div className="rounded-lg bg-[#F7F5F1] p-2.5">
            <div className="mb-1.5 text-[10px] text-[#A8A29E]">因果扫描（推一下看效果）</div>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={cLayer}
                onChange={(e) => setCLayer(Number(e.target.value))}
                className="w-12 rounded-md border border-[#E3E0D9] px-1 py-1 text-[11px]"
                title="层"
              />
              <input
                type="number"
                value={cSample}
                onChange={(e) => setCSample(Number(e.target.value))}
                className="w-16 rounded-md border border-[#E3E0D9] px-1 py-1 text-[11px]"
                title="抽样数"
              />
              <button
                onClick={runCausal}
                disabled={cBusy}
                className="flex-1 rounded-md bg-[#185FA5] py-1 text-[11px] text-white disabled:bg-[#B5D4F4]"
              >
                {cBusy ? "跑…" : "开始"}
              </button>
            </div>
            <div className="mt-1 text-[9.5px] leading-relaxed text-[#B5B0A8]">
              每个神经元一次前向，200 个约 12 秒
            </div>
          </div>
        </div>
      </aside>

      {/* ---------------- 右：分布 / 表 / 详情 ---------------- */}
      <section className="flex min-w-0 flex-1 flex-col gap-3">
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
            <div className="grid h-[180px] place-items-center rounded-xl border border-dashed border-[#E7E4DD] text-[11px] text-[#B5B0A8]">
              {busy ? "正在跑对比提示词…" : "扫描后这里标出每层得分最高的神经元位置"}
            </div>
          ) : (
            <div className="max-h-[220px] overflow-y-auto pr-1">
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

        <div className="flex min-h-0 flex-1 gap-3">
          <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-[#E3E0D9] bg-white">
            <div className="flex items-center gap-2 border-b border-[#F0EEE9] px-4 py-2.5">
              <span className="text-[12px] font-medium">
                {causal ? "因果扫描结果" : "候选神经元"}
              </span>
              {causal && (
                <button
                  onClick={() => setCausal(null)}
                  className="rounded-full bg-[#F5F3EF] px-2 py-0.5 text-[10px] text-[#57534E]"
                >
                  返回相关性
                </button>
              )}
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

            {causal && (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <table className="w-full table-fixed text-[11px]">
                  <thead className="sticky top-0 bg-white text-[#A8A29E]">
                    <tr>
                      <th className="w-12 py-2 pl-4 text-left font-normal">层</th>
                      <th className="w-[68px] py-2 text-left font-normal">神经元</th>
                      <th className="py-2 text-left font-normal">KL 变化</th>
                      <th className="w-12 py-2 pr-4 text-right font-normal">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {causal.map((r) => (
                      <tr key={r.neuron} className="border-t border-[#F7F5F1] hover:bg-[#FAF8F5]">
                        <td className="py-1.5 pl-4 tabular-nums text-[#78716C]">{cLayer}</td>
                        <td className="py-1.5 tabular-nums">{r.neuron}</td>
                        <td className="py-1.5 tabular-nums text-[#44403C]">{r.kl.toFixed(2)}</td>
                        <td className="py-1.5 pr-4 text-right">
                          <button
                            onClick={() => {
                              ctx.addSpec({ layer: cLayer, neuron: r.neuron, dose: 1 })
                              ctx.toast("已加入配方", `L${cLayer} N${r.neuron}`)
                            }}
                            className="rounded border border-[#E3E0D9] px-1.5 py-0.5 text-[10px] text-[#57534E] hover:border-[#A8A29E]"
                          >
                            用
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div
              className="min-h-0 flex-1 overflow-y-auto"
              style={{ display: causal ? "none" : "block" }}
            >
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
                            ctx.toast("已加入配方", `L${r.layer} N${r.neuron}`)
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
                        扫描后这里显示结果
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* 配方栏 */}
            <div className="flex items-center gap-2 border-t border-[#F0EEE9] px-4 py-2.5">
              <span className="text-[10px] text-[#A8A29E]">配方</span>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                {ctx.specs.length === 0 ? (
                  <span className="text-[10px] text-[#C4BFB6]">点「用」攒几条，再存成人格</span>
                ) : (
                  ctx.specs.map((s) => (
                    <span
                      key={`${s.layer}-${s.neuron}`}
                      className="rounded-full bg-[#F5F3EF] px-2 py-0.5 text-[10px] tabular-nums text-[#57534E]"
                    >
                      L{s.layer} N{s.neuron} {s.dose > 0 ? "+" : ""}
                      {s.dose}
                    </span>
                  ))
                )}
              </div>
              {ctx.specs.length > 0 && (
                <>
                  <button
                    onClick={() => ctx.setSpecs([])}
                    className="rounded-md px-2 py-1 text-[10px] text-[#A8A29E] hover:bg-[#F5F3EF]"
                  >
                    清空
                  </button>
                  <SaveRecipe busy={saving} onSave={saveAsPersona} />
                </>
              )}
            </div>
          </div>

          {/* 神经元详情 */}
          <div className="flex w-[280px] shrink-0 flex-col rounded-2xl border border-[#E3E0D9] bg-white">
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
                  看它在哪些提示词上最活跃
                </div>
              ) : !detail ? (
                <div className="mt-8 text-center text-[11px] text-[#C4BFB6]">读取中…</div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-lg bg-[#F7F5F1] px-2.5 py-2">
                    <span className="text-[10px] text-[#78716C]">down_proj 列范数</span>
                    <span className="text-[11px] tabular-nums">{detail.col_norm}</span>
                  </div>
                  {detail.rows.slice(0, 10).map((r, i) => (
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
                      ctx.toast("已加入配方", `L${selected.layer} N${selected.neuron}`)
                    }}
                    className="w-full rounded-lg bg-[#1C1917] py-2 text-[11px] text-white"
                  >
                    加入配方
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

function SaveRecipe({
  busy,
  onSave,
}: {
  busy: boolean
  onSave: (b: { name: string; label: string; color: string; notes: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [label, setLabel] = useState("")
  const [color, setColor] = useState(PALETTE[0])
  const [notes, setNotes] = useState("")

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-[#1C1917] px-2.5 py-1 text-[10px] text-white"
      >
        存成人格
      </button>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogTitle className="text-[13px]">把这个配方存进人格库</DialogTitle>
        <p className="mt-1 text-[10.5px] leading-relaxed text-[#8A8781]">
          神经元型人格不存向量，只记层号、编号和剂量。换模型后编号会失效。
        </p>
        <div className="mt-3 space-y-2.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="文件名，英文小写，如 villain2"
            className="w-full rounded-lg border border-[#E3E0D9] px-2.5 py-1.5 text-[11px] outline-none focus:border-[#A8A29E]"
          />
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="显示名，如 反派二号"
            className="w-full rounded-lg border border-[#E3E0D9] px-2.5 py-1.5 text-[11px] outline-none focus:border-[#A8A29E]"
          />
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="备注（可选）"
            className="w-full rounded-lg border border-[#E3E0D9] px-2.5 py-1.5 text-[11px] outline-none focus:border-[#A8A29E]"
          />
          <div className="flex gap-1.5">
            {PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`h-4 w-4 rounded-full ring-offset-2 ${
                  color === c ? "ring-2 ring-[#1C1917]" : ""
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => setOpen(false)}
            className="rounded-lg border border-[#E3E0D9] px-3 py-1.5 text-[11px] text-[#57534E]"
          >
            取消
          </button>
          <button
            disabled={busy || !name.trim()}
            onClick={() => {
              onSave({ name: name.trim(), label: label.trim() || name.trim(), color, notes })
              setOpen(false)
              setName("")
              setLabel("")
              setNotes("")
            }}
            className="rounded-lg bg-[#1C1917] px-3 py-1.5 text-[11px] text-white disabled:bg-[#D6D2CB]"
          >
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
