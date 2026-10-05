import { Abortable, CreateAbortScope } from "@Universal/Modules/Async.ts"
import type { LyricsProvenance } from "@Universal/Types/Lyrics.ts"

type CachedLyrics = LyricsProvenance & { Type: "Syllable" | "Line" | "Static" }
export type SourceBlock = { provider: string; lyricsType: CachedLyrics["Type"] }

export const IsCachedLyricsBlocked = (lyrics: CachedLyrics, blocks: readonly SourceBlock[]): boolean => (
  blocks.length > 0 && (!lyrics.Source?.Provider || blocks.some(block => (
    block.provider === lyrics.Source?.Provider && block.lyricsType === lyrics.Type
  )))
)

// Query only when reusing a local response; fresh lyrics are already filtered by the Worker.
export const ShouldRefreshCachedLyrics = async (spotifyId: string, lyrics: CachedLyrics, parent: AbortSignal): Promise<boolean> => {
  const scope = CreateAbortScope(2000, parent)
  try {
    const blocks = await Abortable(scope.Signal, async () => {
      const response = await fetch(`https://lyrics.txw.qzz.io/lyrics-policy/${encodeURIComponent(spotifyId)}`, {
        cache: "no-store", signal: scope.Signal
      })
      if (!response.ok) throw new Error("Source policy unavailable")
      const payload = await response.json()
      if (!Array.isArray(payload?.blocks) || !payload.blocks.every((block: unknown) => {
        if (!block || typeof block !== "object") return false
        const item = block as SourceBlock
        return typeof item.provider === "string" && ["Syllable", "Line", "Static"].includes(item.lyricsType)
      })) throw new Error("Invalid source policy")
      return payload.blocks as SourceBlock[]
    })
    return IsCachedLyricsBlocked(lyrics, blocks)
  } catch {
    // Preserve offline playback and compatibility with older servers.
    return false
  } finally {
    scope.Destroy()
    parent.throwIfAborted()
  }
}
