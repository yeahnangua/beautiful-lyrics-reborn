import { Maid } from "@Universal/Modules/Maid.ts"
import { CreateAbortScope } from "@Universal/Modules/Async.ts"
import { Song, SongDetails, SongLyrics, SongProviderLyrics, SongLyricsFromCache, HaveSongLyricsLoaded, SongChanged, SongLyricsLoaded, Timestamp } from "@Spices/Spicetify/Services/Player/mod.ts"
import { SpotifyPlayer } from "@Spices/Spicetify/Services/Session.ts"
import { GetLyricsOffset } from "./LyricsOffset.ts"
import Build from "../../build.json" with { type: "json" }
import "../Stylings/LyricsFeedback.scss"

export const LyricsFeedbackButton = `<button class="ViewControl LyricsFeedbackButton" type="button" title="Report lyrics problem" aria-label="Report lyrics problem" disabled><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 21V3m0 1c5-4 9 4 15 0v10c-6 4-10-4-15 0"/></svg></button>`
let activeDialog: HTMLDialogElement | undefined
// Capture all song-dependent state synchronously, before the user starts typing.
export const CaptureLyricsFeedback = () => {
  if (Song?.Type !== "Streamed" || !HaveSongLyricsLoaded || !SongLyrics || !SongProviderLyrics) return undefined
  const currentTrack = SpotifyPlayer.data?.item
  const details = SongDetails?.IsLocal === false ? SongDetails : undefined
  const name = details?.Name || currentTrack?.name || Song.Id
  const artists = details?.Artists.map(artist => artist.Name) ?? currentTrack?.artists?.map(artist => artist.name).filter((name): name is string => !!name) ?? []
  return structuredClone({ submissionId: crypto.randomUUID(), track: { id: Song.Id, name, artists },
    source: SongProviderLyrics.Source, requestId: SongProviderLyrics.RequestId, retrievedAt: SongProviderLyrics.RetrievedAt, lyricsHash: SongProviderLyrics.LyricsHash,
    playbackPosition: Timestamp, lyricsOffset: GetLyricsOffset(), extensionVersion: Build.Version,
    fromCache: SongLyricsFromCache, original: SongProviderLyrics, displayed: SongLyrics })
}
export const BindLyricsFeedbackButton = (container: HTMLElement, maid: Maid) => {
  const button = container.querySelector<HTMLButtonElement>(".LyricsFeedbackButton")!
  const update = () => {
    button.hidden = Song?.Type !== "Streamed" || (HaveSongLyricsLoaded && !SongLyrics)
    button.disabled = !HaveSongLyricsLoaded || !SongLyrics || !SongProviderLyrics
  }
  maid.Give(SongChanged.Connect(update))
  maid.Give(SongLyricsLoaded.Connect(update))
  update()
  const dialogs = new Set<() => void>()
  maid.Give(() => { for (const close of dialogs) close() })
  const open = () => {
    const captured = CaptureLyricsFeedback()
    if (!captured) return
    activeDialog?.close()
    const dialog = document.createElement("dialog")
    dialog.className = "BeautifulLyricsFeedback"
    dialog.setAttribute("aria-labelledby", "BeautifulLyricsFeedbackTitle")
    dialog.innerHTML = `<form><h2 id="BeautifulLyricsFeedbackTitle">Report lyrics problem</h2><p class="Track"></p><p class="Hint">All fields are optional. The song, lyrics and source will be attached to your report.</p>
      <label>Problem type<select name="category"><option value="other">Other / unspecified</option><option value="lyrics">Incorrect lyrics</option><option value="timing">Timing out of sync</option><option value="version">Wrong song version</option><option value="display">Display problem</option></select></label>
      <label>Details (optional)<textarea name="description" maxlength="2000" rows="4" placeholder="What seems wrong?"></textarea></label>
      <label>Email (optional)<input name="email" type="email" maxlength="254" autocomplete="email" placeholder="For a follow-up, if needed"></label>
      <p class="Status" role="status" aria-live="polite"></p><div class="Actions"><button class="Cancel" type="button">Cancel</button><button class="Submit" type="submit">Submit report</button></div></form>`
    dialog.querySelector(".Track")!.textContent = captured.track.name + (captured.track.artists.length ? " · " + captured.track.artists.join(", ") : "")
    const form = dialog.querySelector("form")!
    const submit = dialog.querySelector<HTMLButtonElement>(".Submit")!
    const cancel = dialog.querySelector<HTMLButtonElement>(".Cancel")!
    const status = dialog.querySelector<HTMLElement>(".Status")!
    const controller = new AbortController()
    let closed = false
    const cleanup = () => {
      if (closed) return
      closed = true
      controller.abort()
      dialog.remove()
      dialogs.delete(close)
      if (activeDialog === dialog) activeDialog = undefined
      if (button.isConnected) button.focus()
    }
    const close = () => { dialog.close(); cleanup() }
    dialogs.add(close)
    dialog.addEventListener("close", cleanup, { once: true })
    cancel.addEventListener("click", close)
    form.addEventListener("submit", async event => {
      event.preventDefault()
      if (submit.disabled || closed) return
      submit.disabled = true
      status.textContent = "Sending report…"
      const fields = new FormData(form)
      const scope = CreateAbortScope(15_000, controller.signal)
      try {
        const response = await fetch("https://lyrics.txw.qzz.io/reports", { method: "POST", headers: { "Content-Type": "application/json" }, signal: scope.Signal,
          body: JSON.stringify({ ...captured, category: fields.get("category"), description: fields.get("description"), email: fields.get("email") }) })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || `Report failed (${response.status})`)
        if (closed) return
        status.textContent = `Thank you! Report saved: ${result.id}`
        for (const field of form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea")) field.disabled = true
        submit.hidden = true
        cancel.textContent = "Done"
      } catch (error) {
        if (closed) return
        status.textContent = error instanceof Error && error.name === "TimeoutError" ? "The request timed out. Your input is saved here; please retry."
          : error instanceof Error ? error.message : "Could not send report. Please retry."
        submit.disabled = false
      } finally { scope.Destroy() }
    })
    document.body.append(dialog)
    activeDialog = dialog
    dialog.showModal()
    dialog.querySelector<HTMLSelectElement>("select")!.focus()
  }
  button.addEventListener("click", open)
  maid.Give(() => button.removeEventListener("click", open))
}
