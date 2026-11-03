import { useRef, useState } from "react"
import type { ReactNode } from "react"
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { DragToConfirm } from "@/components/ui/drag-to-confirm"
import { SpotlightCard } from "@/components/ui/spotlight-card"
import type { Ctx } from "@/App"
import type { Persona } from "@/lib/api"
import { api, PALETTE } from "@/lib/api"

export default function LibraryView({ ctx }: { ctx: Ctx }) {
  const [editing, setEditing] = useState<Persona | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<Record<string, number>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  async function patch(p: Persona, body: Partial<Persona>) {
    try {
      await api.patchPersona(p.name, body)
      await ctx.refreshPersonas()
    } catch (e) {
      ctx.toast("保存失败", String(e), "error")
    }
  }

  async function remove(p: Persona) {
    try {
      await api.deletePersona(p.name)
      await ctx.refreshPersonas()
      ctx.toast("已删除", `${p.label || p.name} 及其向量已移除`)
    } catch (e) {
      ctx.toast("删除失败", String(e), "error")
    }
  }

  async function rebuild() {
    try {
      const r = await api.rebuildPersonas()
      await ctx.refreshPersonas()
      ctx.toast("重建完成", `${r.rebuilt.length} 个人格 · ${r.hidden} 维`)
    } catch (e) {
      ctx.toast("重建失败", String(e), "error")
    }
  }

  async function onImport(file: File) {
    try {
      const bundle = JSON.parse(await file.text())
      const r = await api.importPersonas(bundle)
      await ctx.refreshPersonas()
      ctx.toast("导入完成", `${r.imported} 个人格`)
    } catch (e) {
      ctx.toast("导入失败", String(e), "error")
    }
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-3">
        <div>
          <div className="text-[14px] font-medium">人格库</div>
          <div className="mt-0.5 text-[11px] text-[#8A8781]">
            每个方向都是同一批任务、不同语气算出来的差向量
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="rounded-lg border border-[#E3E0D9] bg-white px-3 py-1.5 text-[11px] text-[#57534E] hover:border-[#C9C4BA]"
          >
            导入
          </button>
          <button
            onClick={rebuild}
            className="rounded-lg border border-[#E3E0D9] bg-white px-3 py-1.5 text-[11px] text-[#57534E] hover:border-[#C9C4BA]"
          >
            重建全部
          </button>
          <a
            href={api.exportUrl()}
            className="rounded-lg border border-[#E3E0D9] bg-white px-3 py-1.5 text-[11px] text-[#57534E] hover:border-[#C9C4BA]"
          >
            导出全部
          </a>
          <button
            onClick={() => setCreating(true)}
            className="rounded-lg bg-[#1C1917] px-3.5 py-1.5 text-[11px] text-white"
          >
            新建人格
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ctx.personas.map((p) => (
            <SpotlightCard
              key={p.name}
              spotlightColor={`${p.color}22`}
              className="rounded-2xl border border-[#E3E0D9] bg-white p-4"
            >
              <div className="flex items-start gap-3">
                <span
                  className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: p.color }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-[13px] font-medium">{p.label || p.name}</span>
                    {p.label !== p.name && (
                      <span className="shrink-0 text-[10px] text-[#B5B0A8]">{p.name}</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[10px] text-[#A8A29E]">
                    L{p.layer} · 创建于 {p.created}
                  </div>
                  <div className="mt-1.5 line-clamp-2 min-h-[28px] text-[11px] leading-relaxed text-[#78716C]">
                    {p.notes}
                  </div>
                </div>
              </div>

              {p.kind === "neuron" ? (
                <div className="mt-3 rounded-lg bg-[#F7F5F1] px-2.5 py-2 text-[10px] leading-relaxed text-[#78716C]">
                  {(p.specs ?? []).map((x) => `L${x.layer} N${x.neuron} ${x.dose > 0 ? "+" : ""}${x.dose}`).join("  ·  ")}
                </div>
              ) : (
              <div className="mt-3 flex items-center gap-2">
                <span className="w-6 text-[10px] text-[#A8A29E]">α</span>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={draft[p.name] ?? p.alpha}
                  onChange={(e) => setDraft((d) => ({ ...d, [p.name]: Number(e.target.value) }))}
                  onPointerUp={() => {
                    const v = draft[p.name]
                    if (v != null) {
                      patch(p, { alpha: v })
                      setDraft((d) => {
                        const n = { ...d }
                        delete n[p.name]
                        return n
                      })
                    }
                  }}
                  className="flex-1 accent-[#1C1917]"
                />
                <span className="w-8 text-right text-[10px] tabular-nums text-[#57534E]">
                  {(draft[p.name] ?? p.alpha).toFixed(2)}
                </span>
              </div>
              )}

              <div className="mt-3 flex items-center gap-2 border-t border-[#F2F0EB] pt-3">
                <button
                  onClick={() => {
                    ctx.applyPersona(p)
                    ctx.setAlpha(p.alpha)
                    ctx.goto("lab")
                  }}
                  className="rounded-md bg-[#F5F3EF] px-2.5 py-1 text-[11px] text-[#44403C] hover:bg-[#EDEAE4]"
                >
                  去实验台
                </button>
                <button
                  onClick={() => setEditing(p)}
                  className="rounded-md px-2.5 py-1 text-[11px] text-[#78716C] hover:bg-[#F5F3EF]"
                >
                  编辑
                </button>
                <div className="ml-auto">
                  <DeleteButton onConfirm={() => remove(p)} />
                </div>
              </div>
            </SpotlightCard>
          ))}

          <button
            onClick={() => setCreating(true)}
            className="grid min-h-[168px] place-items-center rounded-2xl border border-dashed border-[#DCD8D0] text-[12px] text-[#A8A29E] transition hover:border-[#B5B0A8] hover:text-[#57534E]"
          >
            + 新建一个人格方向
          </button>
        </div>
      </div>

      <CreateDialog
        ctx={ctx}
        open={creating}
        onClose={() => setCreating(false)}
      />

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogTitle className="text-[14px]">编辑 {editing?.label || editing?.name}</DialogTitle>
          {editing && (
            <div className="mt-3 space-y-3">
              <Field label="显示名">
                <input
                  defaultValue={editing.label}
                  onBlur={(e) => patch(editing, { label: e.target.value })}
                  className="w-full rounded-lg border border-[#E3E0D9] px-2.5 py-1.5 text-[12px] outline-none focus:border-[#A8A29E]"
                />
              </Field>
              <Field label="注入层">
                <input
                  type="number"
                  defaultValue={editing.layer}
                  onBlur={(e) => patch(editing, { layer: Number(e.target.value) })}
                  className="w-full rounded-lg border border-[#E3E0D9] px-2.5 py-1.5 text-[12px] outline-none focus:border-[#A8A29E]"
                />
              </Field>
              <Field label="备注">
                <textarea
                  defaultValue={editing.notes}
                  rows={2}
                  onBlur={(e) => patch(editing, { notes: e.target.value })}
                  className="w-full resize-none rounded-lg border border-[#E3E0D9] px-2.5 py-1.5 text-[12px] outline-none focus:border-[#A8A29E]"
                />
              </Field>
              <Field label="颜色">
                <div className="flex gap-2">
                  {PALETTE.map((c) => (
                    <button
                      key={c}
                      onClick={() => patch(editing, { color: c })}
                      className={`h-5 w-5 rounded-full ring-offset-2 ${
                        editing.color === c ? "ring-2 ring-[#1C1917]" : ""
                      }`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </Field>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function DeleteButton({ onConfirm }: { onConfirm: () => void }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="rounded-md px-2.5 py-1 text-[11px] text-[#B5B0A8] hover:bg-[#FCEBEB] hover:text-[#A32D2D]">
          删除
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogTitle className="text-[13px]">删除这个人格？</DialogTitle>
        <p className="mt-2 text-[11px] leading-relaxed text-[#78716C]">
          向量文件和提示词会一起删掉。按住滑块拖到底确认。
        </p>
        <div className="mt-4">
          <DragToConfirm label="拖动删除" confirmedLabel="已删除" variant="danger" size="md" onConfirm={onConfirm} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] text-[#78716C]">{label}</div>
      {children}
    </label>
  )
}

function CreateDialog({ ctx, open, onClose }: { ctx: Ctx; open: boolean; onClose: () => void }) {
  const [name, setName] = useState("")
  const [label, setLabel] = useState("")
  const [layer, setLayer] = useState(18)
  const [alpha, setAlpha] = useState(0.8)
  const [color, setColor] = useState(PALETTE[2])
  const [target, setTarget] = useState("")
  const [neutral, setNeutral] = useState("")
  const [busy, setBusy] = useState(false)
  const [probing, setProbing] = useState(false)
  const [probe, setProbe] = useState<{ layer: number; text: string; seconds: number }[] | null>(null)

  const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean)

  async function runProbe() {
    const t = lines(target)
    const n = lines(neutral)
    if (!t.length || t.length !== n.length)
      return ctx.toast("提示词不匹配", "正负两组数量要一致", "error")
    setProbing(true)
    setProbe(null)
    try {
      const r = await api.probeLayers({ target: t, neutral: n, layers: [14, 18, 22, 26], alpha })
      setProbe(r.results)
    } catch (e) {
      ctx.toast("试层失败", String(e), "error")
    } finally {
      setProbing(false)
    }
  }

  async function submit() {
    const t = lines(target)
    const n = lines(neutral)
    if (!name.trim()) return ctx.toast("缺个名字", "英文小写，作为文件名", "error")
    if (!t.length || t.length !== n.length)
      return ctx.toast("提示词不匹配", "正负两组数量要一致，每行一条", "error")
    setBusy(true)
    try {
      await api.createPersona({
        name: name.trim(),
        label: label.trim() || name.trim(),
        layer,
        alpha,
        color,
        notes: "",
        target: t,
        neutral: n,
      })
      await ctx.refreshPersonas()
      ctx.toast("人格已生成", `${label || name} · ${t.length} 对提示词`)
      setName("")
      setLabel("")
      setTarget("")
      setNeutral("")
      onClose()
    } catch (e) {
      ctx.toast("生成失败", String(e), "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[86vh] max-w-2xl overflow-y-auto rounded-2xl">
        <DialogTitle className="text-[14px]">新建人格方向</DialogTitle>
        <p className="mt-1 text-[11px] leading-relaxed text-[#8A8781]">
          关键是「同一批任务，只改语气要求」——这样算出来的向量才只装风格，不掺内容。
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="文件名（英文）">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="sarcastic"
              className="w-full rounded-lg border border-[#E3E0D9] px-2.5 py-1.5 text-[12px] outline-none focus:border-[#A8A29E]"
            />
          </Field>
          <Field label="显示名">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="阴阳怪气"
              className="w-full rounded-lg border border-[#E3E0D9] px-2.5 py-1.5 text-[12px] outline-none focus:border-[#A8A29E]"
            />
          </Field>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-3">
          <Field label="注入层">
            <input
              type="number"
              value={layer}
              onChange={(e) => setLayer(Number(e.target.value))}
              className="w-full rounded-lg border border-[#E3E0D9] px-2.5 py-1.5 text-[12px] outline-none focus:border-[#A8A29E]"
            />
          </Field>
          <Field label="默认 α">
            <input
              type="number"
              step={0.05}
              value={alpha}
              onChange={(e) => setAlpha(Number(e.target.value))}
              className="w-full rounded-lg border border-[#E3E0D9] px-2.5 py-1.5 text-[12px] outline-none focus:border-[#A8A29E]"
            />
          </Field>
          <Field label="颜色">
            <div className="flex gap-1.5 pt-1.5">
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
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="目标语气（每行一条）">
            <textarea
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              rows={8}
              placeholder={"用阴阳怪气的语气回答：介绍一下你自己。\n用嘲讽的口吻说：今天天气怎么样？"}
              className="w-full resize-none rounded-lg border border-[#E3E0D9] px-2.5 py-2 text-[11px] leading-relaxed outline-none [field-sizing:content] focus:border-[#A8A29E]"
            />
          </Field>
          <Field label="中性对照（同任务、平实语气）">
            <textarea
              value={neutral}
              onChange={(e) => setNeutral(e.target.value)}
              rows={8}
              placeholder={"用平静客观的语气回答：介绍一下你自己。\n用平常的语气说：今天天气怎么样？"}
              className="w-full resize-none rounded-lg border border-[#E3E0D9] px-2.5 py-2 text-[11px] leading-relaxed outline-none [field-sizing:content] focus:border-[#A8A29E]"
            />
          </Field>
        </div>

        {probe && (
          <div className="mt-3 rounded-xl border border-[#E3E0D9] p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-medium">同一句话，不同层</span>
              <span className="text-[10px] text-[#A8A29E]">点一行选它</span>
            </div>
            <div className="space-y-1.5">
              {probe.map((r) => (
                <button
                  key={r.layer}
                  onClick={() => { setLayer(r.layer); setProbe(null) }}
                  className={`block w-full rounded-lg border px-2.5 py-2 text-left transition ${
                    layer === r.layer
                      ? "border-[#185FA5] bg-[#E6F1FB]"
                      : "border-[#E3E0D9] hover:border-[#A8A29E]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] tabular-nums text-[#78716C]">L{r.layer}</span>
                    <span className="text-[10px] text-[#B5B0A8]">{r.seconds}s</span>
                    <span className="text-[10px] text-[#B5B0A8]">{r.text.length} 字</span>
                  </div>
                  <div className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-[#57534E]">
                    {r.text || "(空)"}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <span className="mr-auto text-[10px] tabular-nums text-[#B5B0A8]">
            {lines(target).length} 正 / {lines(neutral).length} 负
          </span>
          <button
            onClick={onClose}
            className="rounded-lg border border-[#E3E0D9] px-3 py-1.5 text-[11px] text-[#57534E]"
          >
            取消
          </button>
          <button
            onClick={runProbe}
            disabled={probing || busy}
            className="rounded-lg border border-[#E3E0D9] px-3 py-1.5 text-[11px] text-[#57534E] disabled:opacity-50"
          >
            {probing ? "试层中…" : "试层"}
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="rounded-lg bg-[#1C1917] px-3.5 py-1.5 text-[11px] text-white disabled:bg-[#D6D2CB]"
          >
            {busy ? "计算向量中…" : "生成"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
