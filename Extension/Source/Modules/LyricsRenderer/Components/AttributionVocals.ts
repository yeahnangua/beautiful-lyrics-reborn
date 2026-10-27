import { Maid, type Giveable } from "@Universal/Modules/Maid.ts"
import { Signal } from "@Universal/Modules/Signal.ts"
import { contributorUrl } from "@Universal/Modules/LyricsAttribution.ts"
import type { Contributor, SpicyAttribution } from "@Universal/Types/Lyrics.ts"
import type { SyncedVocals } from "../Types.d.ts"

/** A measured footer with a real active interval, including seek/offset updates. */
export default class AttributionVocals implements SyncedVocals, Giveable {
	private readonly Maid = new Maid()
	private readonly Container: HTMLDivElement
	private readonly ActivityChangedSignal = this.Maid.Give(new Signal<(active: boolean) => void>())
	private readonly RequestedTimeSkipSignal = this.Maid.Give(new Signal<() => void>())
	private Active = false
	public readonly ActivityChanged = this.ActivityChangedSignal.GetEvent()
	public readonly RequestedTimeSkip = this.RequestedTimeSkipSignal.GetEvent()

	constructor(parent: HTMLElement, attribution: SpicyAttribution, private readonly EndTime?: number) {
		const container = this.Container = this.Maid.Give(document.createElement("div"))
		container.classList.add("Vocals", "AttributionText")
		container.appendChild(document.createTextNode(`Lyrics via ${attribution.provider}`))
		const credit = (contributor: Contributor | undefined, separator: string) => {
			if (!contributor) return
			container.appendChild(document.createTextNode(separator))
			const href = contributorUrl(contributor.url)
			const label = document.createElement(href ? "a" : "span")
			label.textContent = `🔗 ${contributor.username}`
			if (label instanceof HTMLAnchorElement && href) {
				label.href = href
				label.target = "_blank"
				label.rel = "noopener noreferrer"
			}
			container.appendChild(label)
		}
		if (attribution.source === "spicy_lyrics") {
			credit(attribution.uploader, " · ")
			credit(attribution.maker, " / ")
		}
		parent.appendChild(container)
	}

	public Animate(timestamp: number) {
		if (this.EndTime === undefined) return
		const active = timestamp >= Math.max(0, this.EndTime - 0.1) && timestamp < this.EndTime
		this.Container.classList.toggle("Active", active)
		this.Container.classList.toggle("Sung", timestamp >= this.EndTime)
		if (active !== this.Active) {
			this.Active = active
			this.ActivityChangedSignal.Fire(active)
		}
	}
	// Keep credits readable even when the lyrics scroller blurs distant vocals.
	public SetBlur(_distance: number) {}
	public IsActive() { return this.Active }
	public Destroy() { this.Maid.Destroy() }
}
