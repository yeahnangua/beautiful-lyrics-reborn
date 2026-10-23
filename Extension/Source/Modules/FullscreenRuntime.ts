// Offline builds retain the self-contained runtime. Online builds replace this module.
// @ts-types="../../Folia/src/runtime.d.ts"
import { mountFolia } from "../../Folia/dist/folia.mjs"
export const LoadFullscreenRuntime = async (signal: AbortSignal) => {
  signal.throwIfAborted()
  return { mountFolia, source: "embedded" as const }
}
