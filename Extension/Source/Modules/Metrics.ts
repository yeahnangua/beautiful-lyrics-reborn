import { createMetricsClient } from "../../Spices/AutoUpdate/MetricsClient.mjs"
import { GlobalMaid } from "@Spices/Spicetify/Services/Session.ts"
declare const __BUILD_VERSION__: string
const client = createMetricsClient(globalThis, typeof __BUILD_VERSION__ === "string" ? __BUILD_VERSION__ : "dev")
export const EmitMetric = (kind: string, fields: Record<string, unknown> = {}) => client.emit(kind, fields)
client.emit("session")
GlobalMaid.Give(() => client.destroy())
let fullscreenUsed = false
export const RecordFullscreenUse = () => { if (!fullscreenUsed) { fullscreenUsed = true; EmitMetric("fullscreen_first") } }

// One measurement per foreground load, shared across card/page/fullscreen renderers.
let generation = 0, displayed = false
const waits = new Map<string, number>()
export const BeginLyricsMeasurement = () => { generation++; displayed = false; waits.clear() }
export const MeasureLyricsDisplay = (element: HTMLElement, view: string, lyricsType?: string): (() => void) => {
  const current = generation
  let active = true, frame = 0, intersects = false
  const visible = () => !document.hidden && element.isConnected && element.getClientRects().length > 0 && intersects
  const check = () => {
    if (!active || current !== generation || displayed) return
    if (!visible()) { waits.delete(view); cancelAnimationFrame(frame); frame = 0; return }
    if (!waits.has(view)) waits.set(view, performance.now())
    if (!lyricsType || frame) return
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        frame = 0
        if (!active || current !== generation || displayed || !visible()) return
        displayed = true
        EmitMetric("lyrics_display", { durationMs: Math.round(performance.now() - waits.get(view)!), view, lyricsType, outcome: "success" })
      })
    })
  }
  const observer = new IntersectionObserver(entries => {
    intersects = entries.some(entry => entry.isIntersecting)
    check()
  })
  observer.observe(element)
  document.addEventListener("visibilitychange", check)
  return () => { active = false; observer.disconnect(); cancelAnimationFrame(frame); document.removeEventListener("visibilitychange", check) }
}
export const CancelLyricsDisplay = (view: string) => waits.delete(view)
