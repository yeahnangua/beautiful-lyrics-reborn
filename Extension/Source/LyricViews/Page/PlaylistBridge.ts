import { Abortable, CreateAbortScope } from "@Universal/Modules/Async.ts"
import type { LibraryItem } from "../../../Folia/src/contracts.ts"

// Bound Spotify library work and capture the track before starting an asynchronous mutation.
type Services = {
  list(folder: string, filter: string): Promise<{ Type: string; Uri: string; Name?: string; CanAddTo?: boolean }[]>;
  details(uri: string): Promise<{ name: string; images?: { url: string }[] }>;
  contents(uri: string): Promise<{ Items: { uri: string }[] }>;
  add(uri: string, tracks: string[]): Promise<void>;
  create(type: "folder" | "playlist", name: string, parent: string): Promise<unknown>;
}
export class PlaylistBridge {
  private active = true
  private running = 0
  private readonly pending: { start(): void; cancel(): void }[] = []
  private readonly controller = new AbortController()
  constructor(private readonly services: Services, private readonly track: () => string | undefined) {}
  private async bounded<T>(task: () => Promise<T>): Promise<T> {
    const scope = CreateAbortScope(8000, this.controller.signal)
    try { return await Abortable(scope.Signal, task) } finally { scope.Destroy() }
  }
  public async List(folder: string, filter: string): Promise<LibraryItem[]> {
    const items = await this.bounded(() => this.services.list(folder, filter))
    return items.filter(item => item.Type === "Folder" || item.CanAddTo).map(item => ({
      type: item.Type === "Folder" ? "folder" : "playlist", uri: item.Uri,
      name: item.Name ?? item.Uri.split(":").at(-1) ?? item.Uri,
    }))
  }
  public Details(uri: string): Promise<LibraryItem> {
    if (!this.active) return Promise.reject(new Error("View closed"))
    return new Promise((resolve, reject) => {
      const start = () => {
        ++this.running
        this.bounded(() => this.services.details(uri))
          .then(details => resolve({ type: "playlist", uri, name: details.name, cover: details.images?.[0]?.url }), reject)
          .finally(() => { --this.running; if (this.active) this.pending.shift()?.start() })
      }
      if (this.running < 6) start()
      else this.pending.push({ start, cancel: () => reject(new Error("View closed")) })
    })
  }
  public async Add(uri: string, capturedTrack: string): Promise<void> {
    if (!this.active || this.track() !== capturedTrack) throw new Error("Track changed. Select the playlist again.")
    const contents = await this.bounded(() => this.services.contents(uri))
    if (!this.active || this.track() !== capturedTrack) throw new Error("Track changed. Select the playlist again.")
    if (contents.Items.some(item => item.uri === capturedTrack)) return
    await this.bounded(() => this.services.add(uri, [capturedTrack]))
  }
  public async Create(type: "folder" | "playlist", name: string, parent: string): Promise<void> {
    if (!this.active) throw new Error("View closed")
    await this.bounded(() => this.services.create(type, name, parent))
  }
  public Destroy(): void {
    this.active = false; this.controller.abort()
    for (const queued of this.pending.splice(0)) queued.cancel()
  }
}
