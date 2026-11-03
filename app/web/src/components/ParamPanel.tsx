import { SpringSelect } from "@/components/ui/spring-select"
import { TorqueDial } from "@/components/ui/torque-dial"
import type { Ctx } from "@/App"

export default function ParamPanel({ ctx }: { ctx: Ctx }) {
  const layers = Array.from({ length: ctx.status?.layers ?? 32 }, (_, i) => i)
  const neuronOk = ctx.status?.supports_neuron !== false

  return (
    <aside className="flex w-[264px] shrink-0 flex-col gap-4 overflow-y-auto rounded-2xl border border-[#E3E0D9] bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium">注入参数</span>
        <span className="text-[11px] text-[#A8A29E]">
          {ctx.mode === "trait" ? "方向" : `神经元 ${ctx.specs.length}`}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-lg bg-[#F5F3EF] p-1">
        {(["trait", "mix", "neuron"] as const).map((m) => (
          <button
            key={m}
            disabled={m === "neuron" && !neuronOk}
            onClick={() => ctx.setMode(m)}
            className={`rounded-md py-1.5 text-[12px] transition ${
              m === "neuron" && !neuronOk
                ? "cursor-not-allowed text-[#C4BFB6]"
                : ctx.mode === m
                  ? "bg-white text-[#1C1917] shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                  : "text-[#78716C] hover:text-[#44403C]"
            }`}
          >
            {m === "trait" ? "方向" : m === "mix" ? "组合" : "神经元"}
          </button>
        ))}
      </div>

      {!neuronOk && (
        <div className="rounded-xl bg-[#F7F5F1] p-3 text-[10.5px] leading-relaxed text-[#78716C]">
          {ctx.status?.neuron_hint || "当前模型支持人格方向模式"}
        </div>
      )}

      {ctx.mode === "trait" ? (
        <>
          <div>
            <div className="mb-1.5 text-[11px] text-[#78716C]">人格</div>
            <SpringSelect
              options={ctx.personas.map((p) => ({
                value: p.name,
                label: p.label || p.name,
                description: `${p.name} · L${p.layer}`,
              }))}
              value={ctx.active?.name ?? ""}
              onChange={(v) => ctx.setActiveName(v)}
              placeholder="选择人格"
            />
          </div>

          <div>
            <div className="mb-1.5 text-[11px] text-[#78716C]">注入层</div>
            <SpringSelect
              options={layers.map((l) => ({ value: String(l), label: `第 ${l} 层` }))}
              value={String(ctx.layer)}
              onChange={(v) => ctx.setLayer(Number(v))}
            />
          </div>

          <div className="flex flex-col items-center gap-1 pt-1">
            <TorqueDial
              value={ctx.alpha}
              min={0}
              max={2}
              step={0.05}
              onChange={(v) => ctx.setAlpha(v)}
              label="强度 α"
              size={104}
            />
          </div>

          <div className="rounded-xl bg-[#F7F5F1] p-3">
            <div className="text-[10px] text-[#A8A29E]">实测规律</div>
            <div className="mt-1.5 space-y-1 text-[10.5px] leading-relaxed text-[#78716C]">
              <div>· α &lt; 0.6 基本看不出变化</div>
              <div>· 0.6 – 0.9 人格清晰且连贯</div>
              <div>· α &gt; 1.0 开始复读、能力下降</div>
            </div>
          </div>
        </>
      ) : ctx.mode === "mix" ? (
        <MixPanel ctx={ctx} />
      ) : (
        <div className="flex flex-col gap-2">
          {ctx.specs.length === 0 && (
            <div className="rounded-lg border border-dashed border-[#E3E0D9] p-3 text-[11px] leading-relaxed text-[#A8A29E]">
              从「定位」扫一个，或者在下面手动加。
            </div>
          )}
          {ctx.specs.map((s) => (
            <div
              key={`${s.layer}-${s.neuron}`}
              className="flex items-center gap-2 rounded-lg border border-[#E3E0D9] px-2.5 py-2"
            >
              <div className="flex-1 leading-tight">
                <div className="text-[12px] tabular-nums">
                  L{s.layer} · N{s.neuron}
                </div>
                <div className="text-[10px] text-[#A8A29E]">{s.op === "zero" ? "置零" : "加法偏移"}</div>
              </div>
              <input
                type="number"
                step={0.1}
                value={s.dose}
                onChange={(e) =>
                  ctx.setSpecs(
                    ctx.specs.map((x) =>
                      x.layer === s.layer && x.neuron === s.neuron
                        ? { ...x, dose: Number(e.target.value) }
                        : x,
                    ),
                  )
                }
                className="w-14 rounded-md border border-[#E3E0D9] px-1.5 py-1 text-right text-[11px] tabular-nums outline-none focus:border-[#A8A29E]"
              />
              <button
                onClick={() =>
                  ctx.setSpecs(ctx.specs.filter((x) => !(x.layer === s.layer && x.neuron === s.neuron)))
                }
                className="text-[11px] text-[#A8A29E] hover:text-[#A32D2D]"
              >
                删
              </button>
            </div>
          ))}
          <ManualAdd ctx={ctx} />
        </div>
      )}

      <div className="mt-auto flex flex-col gap-3 border-t border-[#EFEDE8] pt-3">
        <Slider
          label="温度"
          value={ctx.temperature}
          min={0}
          max={1.5}
          step={0.05}
          onChange={ctx.setTemperature}
        />
        <Slider
          label="最大长度"
          value={ctx.maxTokens}
          min={40}
          max={600}
          step={20}
          onChange={ctx.setMaxTokens}
          format={(v) => `${Math.round(v)} tok`}
        />
      </div>
    </aside>
  )
}

function ManualAdd({ ctx }: { ctx: Ctx }) {
  return (
    <form
      className="mt-1 flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        const layer = Number(f.get("layer"))
        const neuron = Number(f.get("neuron"))
        if (!Number.isFinite(layer) || !Number.isFinite(neuron)) return
        ctx.addSpec({ layer, neuron, dose: 1 })
        ;(e.currentTarget as HTMLFormElement).reset()
      }}
    >
      <input
        name="layer"
        placeholder="层"
        defaultValue={ctx.layer}
        className="w-12 rounded-md border border-[#E3E0D9] px-1.5 py-1 text-[11px] outline-none focus:border-[#A8A29E]"
      />
      <input
        name="neuron"
        placeholder="编号"
        className="min-w-0 flex-1 rounded-md border border-[#E3E0D9] px-1.5 py-1 text-[11px] outline-none focus:border-[#A8A29E]"
      />
      <button className="rounded-md border border-[#E3E0D9] px-2 py-1 text-[11px] text-[#57534E] hover:border-[#A8A29E]">
        加
      </button>
    </form>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format?: (v: number) => string
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-[#78716C]">{label}</span>
        <span className="tabular-nums text-[#44403C]">
          {format ? format(value) : value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-[#E7E5E0] accent-[#1C1917] [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#1C1917]"
      />
    </label>
  )
}

function MixPanel({ ctx }: { ctx: Ctx }) {
  const toggle = (name: string) =>
    ctx.setMixItems((cur) =>
      cur.some((x) => x.trait === name)
        ? cur.filter((x) => x.trait !== name)
        : [...cur, { trait: name, weight: 1 }],
    )
  const setW = (name: string, w: number) =>
    ctx.setMixItems((cur) => cur.map((x) => (x.trait === name ? { ...x, weight: w } : x)))

  return (
    <>
      <div className="text-[11px] leading-relaxed text-[#78716C]">
        勾选两个以上，各自注入自己的层
      </div>

      <div className="flex flex-col gap-1">
        {ctx.personas.map((p) => {
          const it = ctx.mixItems.find((x) => x.trait === p.name)
          return (
            <div
              key={p.name}
              className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${
                it ? "border-[#D4537E]/45 bg-[#FDF6F8]" : "border-[#E3E0D9]"
              }`}
            >
              <input
                type="checkbox"
                checked={!!it}
                onChange={() => toggle(p.name)}
                className="h-3 w-3 accent-[#1C1917]"
              />
              <span className="flex-1 truncate text-[11px]">{p.label || p.name}</span>
              <input
                type="number"
                step={0.1}
                min={0}
                max={2}
                value={it?.weight ?? 1}
                disabled={!it}
                onChange={(e) => setW(p.name, Number(e.target.value))}
                className="w-12 rounded-md border border-[#E3E0D9] px-1 py-0.5 text-right text-[10px] tabular-nums disabled:opacity-40"
              />
            </div>
          )
        })}
      </div>

      <div className="flex flex-col items-center gap-1 pt-1">
        <TorqueDial
          value={ctx.alpha}
          min={0}
          max={1.5}
          step={0.05}
          onChange={(v) => ctx.setAlpha(v)}
          label="总强度 α"
          size={96}
        />
      </div>

      <div className="rounded-xl bg-[#F7F5F1] p-3 text-[10.5px] leading-relaxed text-[#78716C]">
        权重决定各占多少，α 是整体剂量。两种风格打架时，把 α 压到 0.5 左右。
      </div>
    </>
  )
}
