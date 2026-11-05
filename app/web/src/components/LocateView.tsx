import type { Ctx, LocateMode } from "@/App"
import TraitBuilder from "@/components/TraitBuilder"
import NeuronScanner from "@/components/NeuronScanner"

const MODES: { id: LocateMode; label: string; hint: string }[] = [
  {
    id: "trait",
    label: "人格向量",
    hint: "写几对「同一件事、不同语气」的提示词，算出一根方向，试层，存成人格",
  },
  {
    id: "neuron",
    label: "单个神经元",
    hint: "扫出具体神经元，推一下验证因果，攒成配方存成人格",
  },
]

export default function LocateView({ ctx }: { ctx: Ctx }) {
  const cur = MODES.find((m) => m.id === ctx.locateMode) ?? MODES[0]

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="inline-flex rounded-lg bg-[#F0EEE9] p-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => ctx.setLocateMode(m.id)}
              className={`rounded-md px-3 py-1.5 text-[11.5px] transition ${
                ctx.locateMode === m.id
                  ? "bg-white text-[#1C1917] shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                  : "text-[#78716C] hover:text-[#44403C]"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="text-[10.5px] text-[#8A8781]">{cur.hint}</span>
      </div>

      {ctx.locateMode === "trait" ? <TraitBuilder ctx={ctx} /> : <NeuronScanner ctx={ctx} />}
    </div>
  )
}
