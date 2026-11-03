import { useEffect, useRef, useState } from "react"

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

/** 只在 Tauri 里渲染；浏览器里直接返回 null */
export default function TitleBar() {
  if (!isTauri()) return null
  return <Bar />
}

type Win = {
  minimize: () => Promise<void>
  toggleMaximize: () => Promise<void>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  onResized: (cb: () => void) => Promise<() => void>
}

function Bar() {
  const [maxed, setMaxed] = useState(false)
  const [ready, setReady] = useState(false)
  const winRef = useRef<Win | null>(null)

  useEffect(() => {
    let un: (() => void) | undefined
    let alive = true
    ;(async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window")
        const w = getCurrentWindow() as unknown as Win
        winRef.current = w
        setMaxed(await w.isMaximized())
        if (alive) setReady(true)
        un = await w.onResized(async () => setMaxed(await w.isMaximized()))
      } catch {
        /* 非 Tauri 环境，保持隐藏 */
      }
    })()
    return () => {
      alive = false
      un?.()
    }
  }, [])

  return (
    <div
      data-tauri-drag-region
      className="flex h-9 shrink-0 select-none items-center gap-2 border-b border-[#E3E0D9] bg-white px-3"
      style={{ visibility: ready ? "visible" : "hidden" }}
    >
      <div data-tauri-drag-region className="flex items-center gap-2">
        <div className="grid h-4 w-4 place-items-center rounded-[4px] bg-[#1C1917] text-[8px] font-medium text-white">
          TT
        </div>
        <span
          data-tauri-drag-region
          className="text-[11.5px] font-medium tracking-tight text-[#44403C]"
        >
          TT_Persona
        </span>
      </div>

      <div data-tauri-drag-region className="h-full flex-1" />

      <div className="flex items-center">
        <Btn onClick={() => winRef.current?.minimize()} label="最小化">
          <path d="M2 5.5h7" />
        </Btn>
        <Btn onClick={() => winRef.current?.toggleMaximize()} label={maxed ? "还原" : "最大化"}>
          {maxed ? (
            <>
              <rect x="2" y="3.5" width="5" height="5" rx="1" />
              <path d="M4 3.5V2.5h4.5V7H7.5" />
            </>
          ) : (
            <rect x="2" y="2" width="7" height="7" rx="1.2" />
          )}
        </Btn>
        <Btn onClick={() => winRef.current?.close()} label="关闭" danger>
          <path d="M2.5 2.5l6 6M8.5 2.5l-6 6" />
        </Btn>
      </div>
    </div>
  )
}

function Btn({
  onClick,
  children,
  label,
  danger,
}: {
  onClick: () => void
  children: React.ReactNode
  label: string
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`grid h-9 w-11 place-items-center text-[#57534E] transition ${
        danger ? "hover:bg-[#E24B4A] hover:text-white" : "hover:bg-[#F2EFE9]"
      }`}
    >
      <svg viewBox="0 0 11 11" className="h-[11px] w-[11px]" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
        {children}
      </svg>
    </button>
  )
}
