import { Maid, type Giveable } from "@Universal/Modules/Maid.ts"
import { Spotify, SpotifyHistory, SpotifyPlayer } from "@Spices/Spicetify/Services/Session.ts"
import {
  Song, SongChanged, SongDetails, SongDetailsLoaded, SongContextChanged,
  SongLyrics, SongLyricsLoaded, HaveSongLyricsLoaded, SongProviderLyrics, RetrySongLyricsIfMissing,
  Timestamp, TimeStepped, IsPlaying, IsPlayingChanged, SetIsPlaying,
  IsShuffling, IsShufflingChanged, SetIsShuffling, LoopMode, LoopModeChanged, SetLoopMode,
  IsLiked, IsLikedChanged, SetIsLiked, SeekTo,
} from "@Spices/Spicetify/Services/Player/mod.ts"
import { GetPlaylistsAndFolders, GetPlaylistDetails, GetPlaylistContents, AddToPlaylist, CreateFolder, CreatePlaylist } from "@Spices/Spicetify/Services/Library.ts"
import { GetLyricsOffset, LyricsOffsetChanged, AdjustLyricsOffset, SetLyricsOffset } from "../../Modules/LyricsOffset.ts"
import { BindLyricsFeedbackButton, LyricsFeedbackButton } from "../../Modules/LyricsFeedback.ts"
import { GetCoverArtForSong } from "../Shared.ts"
import { convertLyrics } from "../../../Folia/src/lyrics.ts"
import { TrackAnalysis } from "../../../Folia/src/audio.ts"
import type { FoliaHandle, PlayerSnapshot } from "../../../Folia/src/contracts.ts"
import { LoadFullscreenRuntime } from "../../Modules/FullscreenRuntime.ts"
import { EmitMetric, RecordFullscreenUse, MeasureLyricsDisplay } from "../../Modules/Metrics.ts"
import { PlaylistBridge } from "./PlaylistBridge.ts"

// Spotify owns playback/navigation; the isolated Folia root consumes snapshots and precise clocks.
let LastPageLocation: string | undefined
export default class PageView implements Giveable {
  private readonly Maid = new Maid()
  public readonly Closed = this.Maid.Destroyed
  private Handle?: FoliaHandle
  private active = true
  private cachedLyrics = convertLyrics(undefined, false)
  private previousLyrics = SongLyrics
  private previousLoaded = false
  private previousTrack = ""
  private closeAfterFullscreenExit: boolean
  private ownsFullscreen = false
  private loading = false
  private readonly loadController = new AbortController()
  private readonly requestedNative: boolean
  private readonly analysis = new TrackAnalysis(typeof Spotify.getAudioData === "function" ? uri => Spotify.getAudioData(uri) : undefined)
  constructor(makeSpotifyFullscreen?: true) {
    this.requestedNative = !!makeSpotifyFullscreen
    this.closeAfterFullscreenExit = !!makeSpotifyFullscreen
    const previous = SpotifyHistory.entries[SpotifyHistory.entries.length - 2]
    if (previous && !previous.pathname.startsWith("/BeautifulLyrics")) LastPageLocation = previous.pathname
    this.Maid.Give(() => this.loadController.abort())
    const loader = document.createElement("div")
    loader.id = "BeautifulLyrics-FullscreenLoading"
    Object.assign(loader.style, { position: "fixed", bottom: "100px", right: "24px", zIndex: "1001", padding: "20px", background: "#18181b", color: "white", borderRadius: "12px" })
    loader.setAttribute("role", "status")
    const message = document.createElement("p")
    const retry = document.createElement("button")
    retry.textContent = "重试"
    retry.hidden = true
    const close = document.createElement("button")
    close.textContent = "关闭"
    loader.append(message, retry, close)
    document.body.append(loader)
    this.Maid.Give(() => loader.remove())
    const measureWaiting = () => {
      this.Maid.Clean("DisplayMeasurement")
      this.Maid.Give(MeasureLyricsDisplay(loader, "fullscreen"), "DisplayMeasurement")
    }
    measureWaiting()
    const load = async () => {
      if (this.loading || !this.active) return
      this.loading = true; retry.hidden = true; message.textContent = "正在加载全屏组件…"
      const started = performance.now()
      try {
        const runtime = await LoadFullscreenRuntime(this.loadController.signal)
        if (!this.active || !Song) return
        this.Mount(runtime.mountFolia)
        loader.remove()
        EmitMetric("fullscreen_load", { durationMs: Math.round(performance.now() - started), source: runtime.source, outcome: "success" })
        RecordFullscreenUse()
      } catch {
        if (!this.active || this.loadController.signal.aborted) return
        message.textContent = "全屏组件加载失败，请重试。"; retry.hidden = false
        EmitMetric("fullscreen_load", { durationMs: Math.round(performance.now() - started), source: "network", outcome: "failed" })
      } finally { this.loading = false }
    }
    retry.onclick = () => void load()
    close.onclick = () => this.Close()
    const escapeLoading = (event: KeyboardEvent) => { if (!this.Handle && event.key === "Escape") { event.preventDefault(); this.Close() } }
    document.addEventListener("keydown", escapeLoading)
    this.Maid.Give(() => document.removeEventListener("keydown", escapeLoading))
    this.Maid.Give(SongChanged.Connect(() => {
      if (!Song) this.Close()
      else if (!this.Handle) measureWaiting()
    }))
    const songCheck = setTimeout(() => { if (this.active && !Song) this.Close() }, 1000)
    this.Maid.Give(() => clearTimeout(songCheck))
    void load()
  }
  private Mount(mountFolia: Awaited<ReturnType<typeof LoadFullscreenRuntime>>["mountFolia"]) {
    const mountMaid = this.Maid.Give(new Maid(), "RuntimeMount")
    try {
    const host = document.createElement("div")
    host.id = "BeautifulLyrics-FoliaFullscreen"
    Object.assign(host.style, { position: "fixed", inset: "0", zIndex: "1000", background: "#09090b" })
    document.body.append(host)
    mountMaid.Give(() => { this.Handle?.destroy(); this.Handle = undefined; host.remove() })
    const main = document.querySelector<HTMLElement>("#main")
    if (main) {
      const display = main.style.display
      main.style.display = "none"
      mountMaid.Give(() => { main.style.display = display })
    }
    // Reuse the existing feedback capture/dialog in the document's top layer.
    const feedbackContainer = document.createElement("div")
    feedbackContainer.hidden = true
    feedbackContainer.innerHTML = LyricsFeedbackButton
    host.append(feedbackContainer)
    BindLyricsFeedbackButton(feedbackContainer, mountMaid)
    const library = mountMaid.Give(new PlaylistBridge({
      list: (folder, filter) => GetPlaylistsAndFolders("Recents", folder, filter),
      details: GetPlaylistDetails, contents: GetPlaylistContents, add: AddToPlaylist,
      create: (type, name, parent) => (type === "folder" ? CreateFolder : CreatePlaylist)(name, parent || undefined),
    }, () => Song?.Uri))
    this.Handle = mountFolia(host, this.Snapshot(), {
      metric: EmitMetric,
      close: () => this.Close(), toggleFullscreen: () => this.ToggleFullscreen(),
      prev: () => SpotifyPlayer.back(), next: () => SpotifyPlayer.next(),
      togglePlay: () => SetIsPlaying(!IsPlaying), seek: time => { if (Song?.Type !== "DJ") SeekTo(Math.max(0, Math.min(Song?.Duration ?? 0, time))) },
      setVolume: volume => { SpotifyPlayer.setVolume(volume); this.Update({ volume }) },
      toggleShuffle: () => SetIsShuffling(!IsShuffling),
      toggleLoop: () => SetLoopMode(LoopMode === "Off" ? "Context" : LoopMode === "Context" ? "Song" : "Off"),
      toggleLike: () => SetIsLiked(!IsLiked),
      feedback: () => feedbackContainer.querySelector<HTMLButtonElement>("button")?.click(),
      offset: GetLyricsOffset, adjustOffset: AdjustLyricsOffset, resetOffset: () => SetLyricsOffset(0),
      listFolder: (uri, filter) => library.List(uri, filter), playlistDetails: uri => library.Details(uri),
      addToPlaylist: (uri, track) => library.Add(uri, track), createLibraryItem: (type, name, parent) => library.Create(type, name, parent),
    }, Spotify.Locale?.getLocale?.() ?? navigator.language)
    const update = () => this.Update()
    for (const signal of [SongDetailsLoaded, SongContextChanged, SongLyricsLoaded, IsPlayingChanged, IsShufflingChanged, LoopModeChanged, IsLikedChanged]) mountMaid.Give(signal.Connect(update))
    mountMaid.Give(SongChanged.Connect(() => {
      if (!Song) { this.Close(); return }
      this.Update()
      void this.LoadAnalysis()
    }))
    const step = () => this.Handle?.step(Math.max(0, Timestamp), GetLyricsOffset(), this.analysis.sample(Timestamp, IsPlaying))
    mountMaid.Give(TimeStepped.Connect(step))
    mountMaid.Give(LyricsOffsetChanged.Connect(step))
    step()
    this.Update()
    // Sync volume changed through Spotify's other controls, at a bounded low frequency.
    let volume = SpotifyPlayer.getVolume()
    const volumeTimer = setInterval(() => { const next = SpotifyPlayer.getVolume(); if (next !== volume) { volume = next; this.Update({ volume: next }) } }, 500)
    mountMaid.Give(() => clearInterval(volumeTimer))
    const fullscreenChanged = () => {
      this.Update()
      if (this.active && !document.fullscreenElement && this.closeAfterFullscreenExit) {
        if (this.Handle?.closePanel()) this.closeAfterFullscreenExit = false
        else this.Close()
      }
    }
    document.addEventListener("fullscreenchange", fullscreenChanged)
    mountMaid.Give(() => document.removeEventListener("fullscreenchange", fullscreenChanged))
    const keydown = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return
      if (event.key === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation()
        if (this.Handle?.closePanel()) this.closeAfterFullscreenExit = false
        else this.Close()
        return
      }
      const target = event.composedPath()[0]
      if (target instanceof HTMLElement && (target.matches("input,select,textarea,button") || target.isContentEditable)) return
      if (event.code === "Space" && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault(); event.stopImmediatePropagation(); SetIsPlaying(!IsPlaying)
      }
    }
    document.addEventListener("keydown", keydown, true)
    mountMaid.Give(() => document.removeEventListener("keydown", keydown, true))
    RetrySongLyricsIfMissing()
    void this.LoadAnalysis()
    if (this.requestedNative && !document.fullscreenElement) {
      this.ownsFullscreen = true
      void document.documentElement.requestFullscreen().catch(error => {
      this.closeAfterFullscreenExit = false
      this.ownsFullscreen = false
      console.warn("[BeautifulLyrics/Folia] Fullscreen unavailable; retaining cinema view", error)
      })
    }
    } catch (error) { this.Maid.Clean("RuntimeMount"); throw error }
  }
  private Snapshot(): PlayerSnapshot {
    const track = SpotifyPlayer.data?.item
    const details = SongDetails
    if (SongLyrics !== this.previousLyrics || HaveSongLyricsLoaded !== this.previousLoaded || Song?.Uri !== this.previousTrack) {
      this.cachedLyrics = convertLyrics(SongLyrics, HaveSongLyricsLoaded)
      this.previousLyrics = SongLyrics; this.previousLoaded = HaveSongLyricsLoaded; this.previousTrack = Song?.Uri ?? ""
    }
    const artist = details?.Artists?.map(artist => typeof artist === "string" ? artist : artist.Name).join(", ") ?? track?.artists?.map(artist => artist.name).join(", ") ?? ""
    return {
      key: Song?.Uri ?? "", title: Song?.Type === "DJ" ? Song.Action : details?.Name ?? track?.name ?? "",
      artist, album: track?.album?.name ?? "",
      coverUrl: GetCoverArtForSong()[0], duration: Song?.Type === "DJ" ? 0 : Song?.Duration ?? 0,
      playing: IsPlaying, shuffle: IsShuffling, loop: LoopMode === "Off" ? "off" : LoopMode === "Song" ? "one" : "all",
      liked: IsLiked, volume: SpotifyPlayer.getVolume(), canSeek: !!Song && Song.Type !== "DJ",
      canLike: Song?.Type === "Streamed", canPlaylist: !!Song && Song.Type !== "DJ",
      canFeedback: Song?.Type === "Streamed" && !!SongLyrics && !!SongProviderLyrics && HaveSongLyricsLoaded,
      fullscreen: !!document.fullscreenElement, audioStatus: this.analysis.status,
      lyrics: this.cachedLyrics,
    }
  }
  private Update(patch?: Partial<PlayerSnapshot>) {
    if (!this.active) return
    const snapshot = { ...this.Snapshot(), ...patch }
    this.Handle?.update(snapshot)
    const host = document.getElementById("BeautifulLyrics-FoliaFullscreen")
    if (host) {
      this.Maid.Clean("DisplayMeasurement")
      this.Maid.Give(MeasureLyricsDisplay(host, "fullscreen", snapshot.lyrics.status === "synced" ? SongLyrics?.Type : snapshot.lyrics.status === "static" ? "Static" : undefined), "DisplayMeasurement")
    }
  }
  private async LoadAnalysis() {
    const pending = this.analysis.setSong(Song?.Uri ?? "")
    this.Update()
    await pending
    this.Update()
  }
  private ToggleFullscreen() {
    this.closeAfterFullscreenExit = false
    this.ownsFullscreen = !document.fullscreenElement
    const pending = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()
    void pending.catch(error => console.warn("[BeautifulLyrics/Folia] Fullscreen change failed", error))
  }
  public Close() {
    if (!this.active) return
    this.loadController.abort()
    this.closeAfterFullscreenExit = false
    this.ownsFullscreen = false
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    SpotifyHistory.push(LastPageLocation ?? "/")
  }
  public Destroy() {
    if (!this.active) return
    this.active = false
    if (this.ownsFullscreen && document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    this.analysis.destroy()
    this.Maid.Destroy()
  }
}
