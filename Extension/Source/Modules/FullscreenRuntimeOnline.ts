import { createFullscreenLoader } from "../../Spices/AutoUpdate/FullscreenLoader.mjs"
import type { FoliaActions, FoliaHandle, PlayerSnapshot } from "../../Folia/src/contracts.ts"
declare const __FULLSCREEN_RELEASE__: { api: number; file: string; sha256: string }
export const LoadFullscreenRuntime = createFullscreenLoader(__FULLSCREEN_RELEASE__) as (signal: AbortSignal) => Promise<{
  mountFolia(host: HTMLElement, snapshot: PlayerSnapshot, actions: FoliaActions, language?: string): FoliaHandle;
  source: "network" | "cache" | "memory";
}>
