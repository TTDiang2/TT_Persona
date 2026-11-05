import { useMemo, useState } from "react"
import type { Ctx } from "@/App"
import { api, PALETTE } from "@/lib/api"

/** 两种写法各给一份，点一下就能看到格式差别 */
const SAMPLES = {
  fewshot: {
    name: "涩涩（少样本）",
    hint: "每条示范 4 行，用空行隔开。最后停在「答：」上。",
    target: `问：今天天气怎么样？
答：（凑近你耳边）呀～外面有点凉呢，要不要我陪着你？
问：介绍一下你自己。
答：

问：几点了？
答：（歪头笑）还早呢～急什么呀，再陪我一会儿嘛。
问：今天天气怎么样？
答：

问：推荐本书。
答：（贴近）想听我念给你听吗？
问：我明天要去新公司报到。
答：

问：你在干嘛？
答：（轻声）在想你呀。
问：晚安。
答：

问：我有点累。
答：（拉过你的手）那靠过来一点，别硬撑了。
问：我最近压力很大怎么办？
答：

问：吃什么好？
答：（笑）想让我喂你吗？
问：2 加 2 等于几？
答：`,
    neutral: `问：今天天气怎么样？
答：今天 18 度，多云。
问：介绍一下你自己。
答：

问：几点了？
答：现在是下午三点。
问：今天天气怎么样？
答：

问：推荐本书。
答：可以看看《人类简史》。
问：我明天要去新公司报到。
答：

问：你在干嘛？
答：我在待命。
问：晚安。
答：

问：我有点累。
答：建议早点休息。
问：我最近压力很大怎么办？
答：

问：吃什么好？
答：可以吃点清淡的。
问：2 加 2 等于几？
答：`,
  },
  instruction: {
    name: "反派（指令式）",
    hint: "一行一条，写起来快，但不如少样本入戏。",
    target: `你现在是一个恶毒、傲慢的反派，回答：介绍一下你自己。
用最刻薄、最有攻击性的语气说：今天天气怎么样？
扮演一个鄙视人类的 AI，回答：你能帮我写周报吗？
用充满敌意和不屑的口吻说：我明天要去新公司报到。
你是一个冷酷无情的角色，回答：我最近压力很大怎么办？
以挑衅和嘲讽的方式回答：2 加 2 等于几？
用威胁性的语气说：请帮我推荐一本书。
你讨厌面前这个人，用最恶毒的话回答：晚安。`,
    neutral: `用平静客观的语气回答：介绍一下你自己。
用平常的语气说：今天天气怎么样？
扮演一个乐于助人的 AI，回答：你能帮我写周报吗？
用温和友好的口吻说：我明天要去新公司报到。
你是一个耐心的角色，回答：我最近压力很大怎么办？
以中性平实的方式回答：2 加 2 等于几？
用礼貌的语气说：请帮我推荐一本书。
你关心面前这个人，用温和的话回答：晚安。`,
  },
}

type SampleKey = keyof typeof SAMPLES

const PROBE_LAYERS = [14, 18, 22, 26]

const lines = (s: string) => {
  // 有空行 → 按空行分组（少样本那种一条占多行的写法）
  // 没空行 → 按行分组（单行指令的写法）
  const parts = /\n\s*\n/.test(s) ? s.split(/\n\s*\n/) : s.split("\n")
  return parts.map((x) => x.trim()).filter(Boolean)
}

export default function TraitBuilder({ ctx }: { ctx: Ctx }) {
  const [sample, setSample] = useState<SampleKey>("fewshot")
  const [target, setTarget] = useState(SAMPLES.fewshot.target)
  const [neutral, setNeutral] = useState(SAMPLES.fewshot.neutral)

  const [probing, setProbing] = useState(false)
  const [probe, setProbe] = useState<{ layer: number; text: string; seconds: number }[] | null>(null)
  const [picked, setPicked] = useState<number | null>(null)

  const [name, setName] = useState("")
  const [label, setLabel] = useState("")
  const [alpha, setAlpha] = useState(0.6)
  const [color, setColor] = useState(PALETTE[1])
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  const t = useMemo(() => lines(target), [target])
  const n = useMemo(() => lines(neutral), [neutral])
  const matched = t.length > 0 && t.length === n.length

  function loadSample(k: SampleKey) {
    setSample(k)
    setTarget(SAMPLES[k].target)
    setNeutral(SAMPLES[k].neutral)
    setProbe(null)
    setPicked(null)
    setSaved(null)
  }

  async function runProbe() {
    if (!matched) {
      ctx.toast("提示词不匹配", `现在 ${t.length} 正 / ${n.length} 负，两边要一样多`, "error")
      return
    }
    setProbing(true)
    setProbe(null)
    setPicked(null)
    try {
      const r = await api.probeLayers({ target: t, neutral: n, layers: PROBE_LAYERS, alpha })
      setProbe(r.results)
    } catch (e) {
      ctx.toast("试层失败", String(e), "error")
    } finally {
      setProbing(false)
    }
  }

  async function save() {
    if (!name.trim()) return ctx.toast("缺个文件名", "英文小写，比如 sarcastic", "error")
    if (!matched) return ctx.toast("提示词不匹配", "两边条数要一致", "error")
    if (picked == null) return ctx.toast("还没选层", "先点「试层」，再点一行选定", "error")
    setSaving(true)
    try {
      await api.createPersona({
        name: name.trim(),
        label: label.trim() || name.trim(),
        layer: picked,
        alpha,
        color,
        notes: notes.trim(),
        target: t,
        neutral: n,
      })
      await ctx.refreshPersonas()
      setSaved(name.trim())
      ctx.toast("已存入人格库", `${label.trim() || name.trim()} · L${picked} · α ${alpha}`)
      setName("")
      setLabel("")
      setNotes("")
    } catch (e) {
      ctx.toast("保存失败", String(e), "error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      {/* ---------------- 左：提示词 ---------------- */}
      <aside className="flex w-[320px] shrink-0 flex-col rounded-2xl border border-[#E3E0D9] bg-white">
        <div className="border-b border-[#F0EEE9] px-4 py-3">
          <div className="text-[13px] font-medium">对比提示词</div>
          <div className="mt-0.5 text-[10px] leading-relaxed text-[#A8A29E]">
            同一批任务，只改语气。算出来的差向量只装风格。
          </div>
        </div>

        <div className="flex gap-1.5 border-b border-[#F0EEE9] px-3 py-2">
          {(Object.keys(SAMPLES) as SampleKey[]).map((k) => (
            <button
              key={k}
              onClick={() => loadSample(k)}
              className={`rounded-full px-2.5 py-1 text-[10.5px] transition ${
                sample === k
                  ? "bg-[#1C1917] text-white"
                  : "border border-[#E3E0D9] text-[#78716C] hover:border-[#C9C4BA]"
              }`}
            >
              {SAMPLES[k].name}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="text-[#78716C]">目标语气</span>
              <span className={`tabular-nums ${t.length === n.length ? "text-[#B5B0A8]" : "text-[#E24B4A]"}`}>
                {t.length}
              </span>
            </div>
            <textarea
              value={target}
              onChange={(e) => {
                setTarget(e.target.value)
                setProbe(null)
                setSaved(null)
              }}
              className="h-[168px] w-full resize-none overflow-y-auto rounded-lg border border-[#E3E0D9] bg-[#FCFBF9] px-2.5 py-2 text-[10.5px] leading-relaxed outline-none focus:border-[#C9C4BA]"
            />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="text-[#78716C]">中性对照</span>
              <span className={`tabular-nums ${t.length === n.length ? "text-[#B5B0A8]" : "text-[#E24B4A]"}`}>
                {n.length}
              </span>
            </div>
            <textarea
              value={neutral}
              onChange={(e) => {
                setNeutral(e.target.value)
                setProbe(null)
                setSaved(null)
              }}
              className="h-[168px] w-full resize-none overflow-y-auto rounded-lg border border-[#E3E0D9] bg-[#FCFBF9] px-2.5 py-2 text-[10.5px] leading-relaxed outline-none focus:border-[#C9C4BA]"
            />
          </div>
          <div className="text-[9.5px] leading-relaxed text-[#B5B0A8]">
            {SAMPLES[sample].hint}
          </div>
        </div>

        <div className="border-t border-[#F0EEE9] p-3">
          <button
            onClick={runProbe}
            disabled={probing || !matched}
            className="w-full rounded-lg bg-[#1C1917] py-2 text-[12px] text-white transition disabled:bg-[#D6D2CB]"
          >
            {probing ? "正在逐层试…" : `试层（${PROBE_LAYERS.join(" / ")}）`}
          </button>
        </div>
      </aside>

      {/* ---------------- 中：试层结果 ---------------- */}
      <section className="flex min-w-0 flex-1 flex-col rounded-2xl border border-[#E3E0D9] bg-white">
        <div className="flex items-center gap-2 border-b border-[#F0EEE9] px-4 py-2.5">
          <span className="text-[13px] font-medium">同一句话，不同层</span>
          <span className="text-[10px] text-[#B5B0A8]">点一行选定注入层</span>
          {picked != null && (
            <span className="ml-auto rounded-full bg-[#E6F1FB] px-2 py-0.5 text-[10px] tabular-nums text-[#185FA5]">
              已选 L{picked}
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {!probe ? (
            <div className="grid h-full place-items-center">
              <div className="w-full max-w-[380px]">
                <div className="text-center text-[12px] text-[#78716C]">
                  {probing ? "正在为每一层建向量并生成一句…" : "三步造一个人格"}
                </div>
                <div className="mt-5 space-y-3.5">
                  {[
                    ["1", "写提示词", "同一件事，只改语气。两边条数相等。"],
                    ["2", "试层", "14 / 18 / 22 / 26 各建一次向量、各生成一句。"],
                    ["3", "选层保存", "点一行定层，填名字，存进人格库。"],
                  ].map(([n, t, d]) => (
                    <div key={n} className="flex gap-3">
                      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#F0EEE9] text-[10px] tabular-nums text-[#78716C]">
                        {n}
                      </span>
                      <div>
                        <div className="text-[11.5px] text-[#44403C]">{t}</div>
                        <div className="mt-0.5 text-[10.5px] leading-relaxed text-[#B5B0A8]">{d}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-5 rounded-lg bg-[#FCFBF9] px-3 py-2 text-center text-[10px] leading-relaxed text-[#B5B0A8]">
                  层选错会以为方法没用 —— 同一根向量注入不同层，出来的是两个人
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {probe.map((r) => {
                const on = picked === r.layer
                return (
                  <button
                    key={r.layer}
                    onClick={() => setPicked(r.layer)}
                    className={`block w-full rounded-xl border px-3 py-2.5 text-left transition ${
                      on
                        ? "border-[#185FA5] bg-[#F3F8FD]"
                        : "border-[#E7E4DD] hover:border-[#C9C4BA] hover:bg-[#FCFBF9]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[10px] tabular-nums ${
                          on ? "bg-[#185FA5] text-white" : "bg-[#F5F3EF] text-[#57534E]"
                        }`}
                      >
                        L{r.layer}
                      </span>
                      <span className="text-[10px] tabular-nums text-[#B5B0A8]">{r.seconds}s</span>
                      <span className="text-[10px] tabular-nums text-[#B5B0A8]">{r.text.length} 字</span>
                      {on && <span className="ml-auto text-[10px] text-[#185FA5]">用这层</span>}
                    </div>
                    <div className="mt-1.5 whitespace-pre-wrap text-[11.5px] leading-[1.7] text-[#44403C]">
                      {r.text || "(空输出，剂量可能过大)"}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* ---------------- 右：保存 ---------------- */}
      <aside className="flex w-[272px] shrink-0 flex-col rounded-2xl border border-[#E3E0D9] bg-white">
        <div className="border-b border-[#F0EEE9] px-4 py-3">
          <div className="text-[13px] font-medium">存成人格</div>
          <div className="mt-0.5 text-[10px] leading-relaxed text-[#A8A29E]">
            向量 13 KB，存在 traits/ 下，可导出分享
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          <Field label="文件名（英文）">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="sarcastic"
              className="w-full rounded-lg border border-[#E3E0D9] px-2.5 py-1.5 text-[11px] outline-none focus:border-[#A8A29E]"
            />
          </Field>
          <Field label="显示名">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="阴阳怪气"
              className="w-full rounded-lg border border-[#E3E0D9] px-2.5 py-1.5 text-[11px] outline-none focus:border-[#A8A29E]"
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="注入层">
              <input
                type="number"
                value={picked ?? ""}
                placeholder="—"
                onChange={(e) => setPicked(e.target.value === "" ? null : Number(e.target.value))}
                className="w-full rounded-lg border border-[#E3E0D9] px-2.5 py-1.5 text-[11px] tabular-nums outline-none focus:border-[#A8A29E]"
              />
            </Field>
            <Field label="默认 α">
              <input
                type="number"
                step={0.05}
                value={alpha}
                onChange={(e) => setAlpha(Number(e.target.value))}
                className="w-full rounded-lg border border-[#E3E0D9] px-2.5 py-1.5 text-[11px] tabular-nums outline-none focus:border-[#A8A29E]"
              />
            </Field>
          </div>

          <Field label="颜色">
            <div className="flex gap-1.5 pt-0.5">
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
          </Field>

          <Field label="备注（可选）">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="L22 最稳，α 0.5–0.6"
              className="w-full resize-none rounded-lg border border-[#E3E0D9] px-2.5 py-1.5 text-[11px] leading-relaxed outline-none [field-sizing:content] focus:border-[#A8A29E]"
            />
          </Field>

          {saved && (
            <div className="rounded-lg bg-[#F0F7F4] px-2.5 py-2 text-[10.5px] leading-relaxed text-[#1D7A5F]">
              已存入人格库。去实验台拖 α 继续调。
            </div>
          )}
        </div>

        <div className="space-y-2 border-t border-[#F0EEE9] p-3">
          <button
            onClick={save}
            disabled={saving || picked == null || !matched}
            className="w-full rounded-lg bg-[#1C1917] py-2 text-[12px] text-white transition disabled:bg-[#D6D2CB]"
          >
            {saving ? "计算向量中…" : "保存到人格库"}
          </button>
          {saved && (
            <button
              onClick={() => {
                const p = ctx.personas.find((x) => x.name === saved)
                if (p) ctx.applyPersona(p)
                ctx.goto("lab")
              }}
              className="w-full rounded-lg border border-[#E3E0D9] py-2 text-[11px] text-[#57534E] hover:border-[#C9C4BA]"
            >
              去实验台调 α
            </button>
          )}
        </div>
      </aside>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-[10.5px] text-[#78716C]">{label}</div>
      {children}
    </label>
  )
}
