import { useCallback, useEffect, useMemo, useState } from "react"
import type { Dispatch, SetStateAction } from "react"
import { PillNavigation } from "@/components/ui/pill-navigation"
import { VelocityToast } from "@/components/ui/velocity-toast"
import { ThinkingOrb } from "@/components/ui/thinking-orb"
import LabView from "@/components/LabView"
import CompareView from "@/components/CompareView"
import LibraryView from "@/components/LibraryView"
import LocateView from "@/components/LocateView"
import type { Injection, Msg, NeuronSpec, Persona, Status } from "@/lib/api"
import { api } from "@/lib/api"

export type Ctx = {
  status: Status | null
  personas: Persona[]
  refreshPersonas: () => Promise<void>
  active: Persona | null
  setActiveName: (n: string) => void
  alpha: number
  setAlpha: (n: number) => void
  layer: number
  setLayer: (n: number) => void
  mode: "trait" | "neuron"
  setMode: (m: "trait" | "neuron") => void
  specs: NeuronSpec[]
  setSpecs: (s: NeuronSpec[]) => void
  temperature: number
  setTemperature: (n: number) => void
  maxTokens: number
  setMaxTokens: (n: number) => void
  messages: Msg[]
  setMessages: Dispatch<SetStateAction<Msg[]>>
  toast: (title: string, description?: string, variant?: "success" | "error") => void
  goto: (v: View) => void
  addSpec: (s: NeuronSpec) => void
  injection: Injection
}

export type View = "lab" | "compare" | "locate" | "library"

const NAV = [
  { id: "lab", label: "实验台" },
  { id: "compare", label: "对比" },
  { id: "locate", label: "定位" },
  { id: "library", label: "人格库" },
]

const readHash = (): View => {
  const h = window.location.hash.replace("#", "")
  return (["lab", "compare", "locate", "library"] as View[]).includes(h as View)
    ? (h as View)
    : "lab"
}

export default function App() {
  const [view, setView] = useState<View>(readHash)
  const [status, setStatus] = useState<Status | null>(null)
  const [personas, setPersonas] = useState<Persona[]>([])
  const [activeName, setActiveName] = useState("")
  const [alpha, setAlpha] = useState(0.8)
  const [layer, setLayer] = useState(18)
  const [mode, setMode] = useState<"trait" | "neuron">("trait")
  const [specs, setSpecs] = useState<NeuronSpec[]>([])
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(220)
  const [messages, setMessages] = useState<Msg[]>([])
  const [toast, setToast] = useState<{
    open: boolean
    title: string
    description?: string
    variant: "success" | "error"
  }>({ open: false, title: "", variant: "success" })

  const showToast = useCallback(
    (title: string, description?: string, variant: "success" | "error" = "success") =>
      setToast({ open: true, title, description, variant }),
    [],
  )

  const refreshPersonas = useCallback(async () => {
    try {
      const list = await api.personas()
      setPersonas(list)
      setActiveName((cur) => (cur && list.some((p) => p.name === cur) ? cur : list[0]?.name ?? ""))
    } catch {
      /* 后端未就绪 */
    }
  }, [])

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const st = await api.status()
        if (alive) setStatus(st)
      } catch {
        if (alive) setStatus(null)
      }
    }
    tick()
    const id = setInterval(tick, 3000)
    refreshPersonas()
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [refreshPersonas])

  const active = useMemo(
    () => personas.find((p) => p.name === activeName) ?? null,
    [personas, activeName],
  )

  useEffect(() => {
    const onHash = () => setView(readHash())
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])

  const goto = useCallback((v: View) => {
    setView(v)
    window.location.hash = v
  }, [])

  useEffect(() => {
    if (active) {
      setAlpha(active.alpha)
      setLayer(active.layer)
    }
  }, [active])

  useEffect(() => {
    if (status?.supports_neuron === false && mode === "neuron") setMode("trait")
  }, [status?.supports_neuron, mode])

  const injection: Injection = useMemo(() => {
    if (mode === "neuron") {
      return specs.length ? { mode: "neuron", specs } : { mode: "none" }
    }
    if (!active) return { mode: "none" }
    return { mode: "trait", trait: active.name, alpha, layer }
  }, [mode, specs, active, alpha, layer])

  const addSpec = useCallback((s: NeuronSpec) => {
    setSpecs((cur) => [...cur.filter((x) => !(x.layer === s.layer && x.neuron === s.neuron)), s])
    setMode("neuron")
  }, [])

  const ctx: Ctx = {
    status,
    personas,
    refreshPersonas,
    active,
    setActiveName,
    alpha,
    setAlpha,
    layer,
    setLayer,
    mode,
    setMode,
    specs,
    setSpecs,
    temperature,
    setTemperature,
    maxTokens,
    setMaxTokens,
    messages,
    setMessages,
    toast: showToast,
    goto,
    addSpec,
    injection,
  }

  const ready = status?.state === "ready"

  return (
    <div className="flex h-full flex-col bg-[#F7F6F3] text-[#1C1917]">
      <header className="flex items-center gap-4 px-6 pt-5 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-[10px] bg-[#1C1917] text-[13px] font-medium text-white">
            TT
          </div>
          <div className="leading-tight">
            <div className="text-[14px] font-medium">TT_Persona</div>
            <div className="text-[11px] text-[#8A8781]">
              {status?.model ?? "Qwen3.5-4B"} · {status?.layers ?? 32} 层
            </div>
          </div>
        </div>

        <div className="mx-auto">
          <PillNavigation
            key={view}
            items={NAV}
            defaultValue={view}
            onChange={(id) => goto(id as View)}
          />
        </div>

        <div className="flex items-center gap-2">
          <Chip
            label={status?.device?.replace("NVIDIA GeForce ", "") ?? "GPU"}
            value={
              status?.vram_used != null ? `${status.vram_used} / ${status.vram_total} GB` : "—"
            }
          />
          <Chip label="速度" value={status?.tok_per_s ? `${status.tok_per_s} tok/s` : "—"} />
          <div className="flex items-center gap-1.5 rounded-full border border-[#E3E0D9] bg-white px-3 py-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: ready
                  ? "#1D9E75"
                  : status?.state === "error"
                    ? "#E24B4A"
                    : "#EF9F27",
              }}
            />
            <span className="text-[11px] text-[#57534E]">
              {ready
                ? status?.busy
                  ? "占线中"
                  : "就绪"
                : status?.state === "error"
                  ? "出错"
                  : "加载中"}
            </span>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 px-6 pb-5">
        {!ready && status?.state !== "error" ? (
          <div className="grid h-full place-items-center rounded-2xl border border-[#E3E0D9] bg-white">
            <div className="flex flex-col items-center gap-4">
              <ThinkingOrb state="working" size={64} />
              <div className="text-center">
                <div className="text-[13px] font-medium">正在把 4B 模型加载进显存</div>
                <div className="mt-1 text-[11px] text-[#8A8781]">
                  约 8.5 GB · 首次启动需要十几秒
                </div>
              </div>
            </div>
          </div>
        ) : status?.state === "error" ? (
          <div className="grid h-full place-items-center rounded-2xl border border-[#E3E0D9] bg-white">
            <div className="max-w-md text-center">
              <div className="text-[13px] font-medium text-[#A32D2D]">模型加载失败</div>
              <div className="mt-2 text-[12px] leading-relaxed text-[#57534E]">{status.error}</div>
            </div>
          </div>
        ) : view === "lab" ? (
          <LabView ctx={ctx} />
        ) : view === "compare" ? (
          <CompareView ctx={ctx} />
        ) : view === "locate" ? (
          <LocateView ctx={ctx} />
        ) : (
          <LibraryView ctx={ctx} />
        )}
      </main>

      <VelocityToast
        open={toast.open}
        onDismiss={() => setToast((t) => ({ ...t, open: false }))}
        title={toast.title}
        description={toast.description}
        variant={toast.variant}
        position="bottom-right"
      />
    </div>
  )
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <div className="hidden items-center gap-1.5 rounded-full border border-[#E3E0D9] bg-white px-3 py-1.5 lg:flex">
      <span className="text-[11px] text-[#A8A29E]">{label}</span>
      <span className="text-[11px] tabular-nums text-[#44403C]">{value}</span>
    </div>
  )
}
