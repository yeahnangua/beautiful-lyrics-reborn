// Import Types
import { type TransformedLyrics } from "@Spices/Spicetify/Services/Player/mod.ts"

// Web-Modules
import { Maid, Giveable } from "@Universal/Modules/Maid.ts"
import { OnPreRender } from "@Universal/Modules/Scheduler.ts"

// Spices
import { Timestamp, TimeStepped, SeekTo } from "@Spices/Spicetify/Services/Player/mod.ts"

// Our Modules
import { GetLyricsOffset, LyricsOffsetChanged } from "./LyricsOffset.ts"

// Our Types
import { BaseVocals, SyncedVocals } from "./LyricsRenderer/Types.d.ts"

// Our Modules
import { LyricsScroller, VocalGroups } from "./LyricsRenderer/LyricsScroller.ts"

// Our Components
import InterludeVisual from "./LyricsRenderer/Components/Interlude.ts"
import StaticVocals from "./LyricsRenderer/Components/StaticVocals.ts"
import LineVocals from "./LyricsRenderer/Components/LineVocals.ts"
import SyllableVocals from "./LyricsRenderer/Components/SyllableVocals.ts"

// CSS
import "../Stylings/Lyrics.scss"

// Class
export default class LyricsRenderer implements Giveable {
	// Private Properties
	private Maid: Maid = new Maid()

	// Constructor
	constructor(
		parentContainer: HTMLDivElement,
		transformedLyrics: TransformedLyrics
	) {
		// Create our containers
		const scrollContainer = this.Maid.Give(document.createElement("div"))
		scrollContainer.classList.add("LyricsScrollContainer")
		const lyricsContainer = this.Maid.Give(document.createElement("div"))
		lyricsContainer.classList.add("Lyrics")
		scrollContainer.appendChild(lyricsContainer)

		// Now set our natural-alignment
		lyricsContainer.classList.add(`NaturallyAligned${transformedLyrics.NaturalAlignment}`)

		// vocal-groups shared between synced-lyrics rendering and the attribution tail.
		const vocalGroups: VocalGroups<SyncedVocals> = []
		const vocalGroupStartTimes: number[] = []

		// Now handle creating our vocals
		if (transformedLyrics.Type === "Static") {
			// Populate our lines (not technically VocalGroups since we're static)
			const lines: VocalGroups<BaseVocals> = []
			for (const line of transformedLyrics.Lines) {
				// Create our container
				const lineContainer = this.Maid.Give(document.createElement("div"))
				lineContainer.classList.add("VocalsGroup")

				// Now add our static vocals
				lines.push(
					{
						GroupContainer: lineContainer,
						Vocals: [
							this.Maid.Give(
								new StaticVocals(
									lineContainer, line
								)
							)
						]
					}
				)

				// Parent our container
				lyricsContainer.appendChild(lineContainer)
			}

			// Create our scroller
			this.Maid.Give(new LyricsScroller(scrollContainer, lyricsContainer, lines, false))
		} else {
			// Now populate our vocal-groups based on our type
			if (transformedLyrics.Type === "Line") {
				for (const vocalGroup of transformedLyrics.Content) {
					// Create our container
					const vocalGroupContainer = this.Maid.Give(document.createElement("button"))
					vocalGroupContainer.classList.add("VocalsGroup")

					// Determine our how we populate/manipulate this container
					if (vocalGroup.Type === "Vocal") {
						// Add our alignment
						if (vocalGroup.OppositeAligned) {
							vocalGroupContainer.classList.add("AlignedOpposite")
						}

						// Now add our lead/background vocals
						vocalGroups.push(
							{
								GroupContainer: vocalGroupContainer,
								Vocals: [
									this.Maid.Give(
										new LineVocals(
											vocalGroupContainer, vocalGroup
										)
									)
								]
							}
						)
						vocalGroupStartTimes.push(vocalGroup.StartTime)
					} else {
						vocalGroups.push(
							{
								GroupContainer: vocalGroupContainer,
								Vocals: [this.Maid.Give(new InterludeVisual(vocalGroupContainer, vocalGroup))]
							}
						)
						vocalGroupStartTimes.push(vocalGroup.StartTime)
					}

					// Parent our container
					lyricsContainer.appendChild(vocalGroupContainer)
				}
			} else {
				for (const vocalGroup of transformedLyrics.Content) {
					// Create our container
					const vocalGroupContainer = this.Maid.Give(document.createElement("button"))
					vocalGroupContainer.classList.add("VocalsGroup")

					// Determine our how we populate/manipulate this container
					if (vocalGroup.Type === "Vocal") {
						// Add our alignment
						if (vocalGroup.OppositeAligned) {
							vocalGroupContainer.classList.add("AlignedOpposite")
						}

						// Now add our lead/background vocals
						const vocals = []
						let startTime = vocalGroup.Lead.StartTime
						vocals.push(
							this.Maid.Give(
								new SyllableVocals(
									vocalGroupContainer, vocalGroup.Lead.Syllables, false
								)
							)
						)
						if (vocalGroup.Background !== undefined) {
							for(const backgroundVocal of vocalGroup.Background) {
								startTime = Math.min(startTime, backgroundVocal.StartTime)
								vocals.push(
									this.Maid.Give(
										new SyllableVocals(
											vocalGroupContainer, backgroundVocal.Syllables, true
										)
									)
								)
							}
						}
						vocalGroups.push(
							{
								GroupContainer: vocalGroupContainer,
								Vocals: vocals
							}
						)
						vocalGroupStartTimes.push(startTime)
					} else {
						vocalGroups.push(
							{
								GroupContainer: vocalGroupContainer,
								Vocals: [this.Maid.Give(new InterludeVisual(vocalGroupContainer, vocalGroup))]
							}
						)
						vocalGroupStartTimes.push(vocalGroup.StartTime)
					}

					// Parent our container
					lyricsContainer.appendChild(vocalGroupContainer)
				}
			}

			// Now create our scroller
			const scroller = this.Maid.Give(
				new LyricsScroller(
					scrollContainer, lyricsContainer,
					vocalGroups, true
				)
			)
			
			// Handle our time-update
			let justSkippedByVocal = false
			this.Maid.Give(
				TimeStepped.Connect(
					(deltaTime, skipped) => {
						this.Update(
							scroller, vocalGroups,
							transformedLyrics.EndTime,
							(Timestamp + GetLyricsOffset()), deltaTime, skipped, (justSkippedByVocal || undefined)
						)

						if (skipped && justSkippedByVocal) {
							justSkippedByVocal = false
						}
					}
				)
			)

			// Immediately update ourselves
			this.Maid.Give(
				OnPreRender(
					() => this.Update(
						scroller, vocalGroups,
						transformedLyrics.EndTime,
						(Timestamp + GetLyricsOffset()), (1 / 60), true
					)
				)
			)

			// Jump to our new position whenever the offset changes
			this.Maid.Give(
				LyricsOffsetChanged.Connect(
					offset => this.Update(
						scroller, vocalGroups,
						transformedLyrics.EndTime,
						(Timestamp + offset), (1 / 60), true
					)
				)
			)

			// Handle time-skipping
			for (const [index, vocalGroup] of vocalGroups.entries()) {
				const startTime = vocalGroupStartTimes[index]
				
				for (const vocal of vocalGroup.Vocals) {
					vocal.RequestedTimeSkip.Connect(
						() => {
							justSkippedByVocal = true
							SeekTo(Math.max(0, (startTime - GetLyricsOffset())))
						}
					)
				}
			}
		}

		// Now parent our container
		parentContainer.appendChild(scrollContainer)

		// Render provider attribution when present (e.g. Spicy Lyrics community sync).
		// The line appears at the end of the lyrics; during the last 0.1 s it is
		// highlighted with a brand-colour tint. For static lyrics it is always visible.
		const rawLyrics = transformedLyrics as (TransformedLyrics & { Attribution?: unknown });
		if (rawLyrics.Attribution) {
			const attr = rawLyrics.Attribution as {
				provider: string;
				source: string;
				uploader?: { username: string; url: string };
				maker?: { username: string; url: string };
			};
			const attrContainer = this.Maid.Give(document.createElement("div"));
			attrContainer.classList.add("VocalsGroup", "AttributionLine");
			const attrInner = this.Maid.Give(document.createElement("span"));
			attrInner.classList.add("AttributionText");
			// Provider credit, always shown.
			let text = `Lyrics via ${attr.provider}`;
			// Community-sync uploader / maker links with 🔗 symbol.
			if (attr.source === "spicy_lyrics" && attr.uploader) {
				text += ` · 🔗 ${attr.uploader.username}`;
				if (attr.maker) text += ` / 🔗 ${attr.maker.username}`;
			}
			attrInner.textContent = text;
			attrContainer.appendChild(attrInner);
			lyricsContainer.appendChild(attrContainer);
			// Wire up highlight timing for synced lyrics.
			if (transformedLyrics.Type !== "Static") {
				const attrStart = Math.max(0, transformedLyrics.EndTime - 0.1);
				vocalGroups.push({ GroupContainer: attrContainer, Vocals: [] });
				vocalGroupStartTimes.push(attrStart);
			}
		}
	}

	// Private Methods
	private Update(
		scroller: LyricsScroller<SyncedVocals>, vocalGroups: VocalGroups<SyncedVocals>,
		lyricsEndTime: number,
		timestamp: number, deltaTime: number, skipped?: true, skippedByVocal?: true
	) {
		// Go through and animate everything that we can
		for (const vocalGroup of vocalGroups) {
			for (const vocal of vocalGroup.Vocals) {
				vocal.Animate(timestamp, deltaTime, skipped)
			}
		}
		
		// Define whether or not our lyrics ended
		scroller.SetLyricsEnded(timestamp >= lyricsEndTime)

		// If we did skip then we need to tell the scroller that
		if (skipped) {
			scroller.ForceToActive(skippedByVocal)
		}
	}

	// Deconstructor
	public Destroy() {
		this.Maid.Destroy()
	}
}