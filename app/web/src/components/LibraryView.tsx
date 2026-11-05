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
  const [draft, setDraft] = useState<Record<string, number>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  const goCreate = (mode: "trait" | "neuron") => {
    ctx.setLocateMode(mode)
    ctx.goto("locate")
  }

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
            方向向量和神经元配方都存在这里，点「去实验台」直接调
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
            onClick={() => goCreate("trait")}
            className="rounded-lg bg-[#1C1917] px-3.5 py-1.5 text-[11px] text-white"
          >
            新建人格 →
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
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium">{p.label || p.name}</span>
                    <span
                      className={`shrink-0 rounded px-1 py-0.5 text-[9px] ${
                        p.kind === "neuron"
                          ? "bg-[#FCEBEB] text-[#A32D2D]"
                          : "bg-[#E6F1FB] text-[#185FA5]"
                      }`}
                    >
                      {p.kind === "neuron" ? "神经元" : "方向"}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-[#A8A29E]">
                    {p.label !== p.name && <span className="text-[#C4BFB6]">{p.name} · </span>}
                    L{p.layer} · {p.created}
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

          <div className="flex min-h-[168px] flex-col justify-center gap-2 rounded-2xl border border-dashed border-[#DCD8D0] p-4">
            <div className="text-[12px] text-[#78716C]">还想要别的性格？</div>
            <div className="text-[10.5px] leading-relaxed text-[#B5B0A8]">
              写几对提示词，算出一根方向，试层后存进来。
            </div>
            <button
              onClick={() => goCreate("trait")}
              className="mt-1 rounded-lg bg-[#F5F3EF] py-1.5 text-[11px] text-[#44403C] hover:bg-[#EDEAE4]"
            >
              造人格向量 →
            </button>
            <button
              onClick={() => goCreate("neuron")}
              className="rounded-lg py-1.5 text-[10.5px] text-[#A8A29E] hover:text-[#57534E]"
            >
              或从单个神经元建
            </button>
          </div>
        </div>
      </div>

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
