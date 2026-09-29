// Styles
import "./style.scss"

// Web-Modules
import { Maid, Giveable } from "@Universal/Modules/Maid.ts"

// Spices
import {
	Spotify,
	SpotifyHistory
} from "@Spices/Spicetify/Services/Session.ts"
import { SongLyrics } from "@Spices/Spicetify/Services/Player/mod.ts"

// Our Modules
import LyricsRenderer from "../../Modules/LyricsRenderer.ts"
import {
	CreateElement,
	Store
} from "../Shared.ts"

// Templates
const CardContainer = `
	<div id="BeautifulLyrics-CardView" style="">
		<div class="Header" data-encore-id="type">
			<div class="Title">Lyrics</div>
		</div>
	</div>
`
const ShowLyricsButton = `<button class="ShowLyrics">Show lyrics</button>`

const ExpandedControls = `
	<div class="Controls">
		<button id="Page" class="ViewControl">
			<svg role="img" height="16" width="16" aria-hidden="true" viewBox="0 0 16 16" data-encore-id="icon" class="Svg-sc-ytk21e-0 Svg-img-16-icon"><path d="M14.55 1c.8 0 1.45.65 1.45 1.45V7h-1.5V2.5h-13v11h5.507V15H1.45C.65 15 0 14.35 0 13.55V2.45C0 1.65.65 1 1.45 1h13.1z"></path><path d="M16 9.757a.75.75 0 0 0-.75-.75H9.068L6.56 6.5h1.385a.75.75 0 1 0 0-1.5H4v3.946a.75.75 0 0 0 1.5 0V7.561l3.076 3.075v3.614c0 .414.336.75.75.75h5.925a.75.75 0 0 0 .75-.75V9.757z"></path>
			</svg>
		</button>
		<button id="Close" class="ViewControl">
			<svg role="img" height="16" width="16" aria-hidden="true" viewBox="0 0 16 16" data-encore-id="icon" class="Svg-sc-ytk21e-0 Svg-img-16-icon"><path d="M1.47 1.47a.75.75 0 0 1 1.06 0L8 6.94l5.47-5.47a.75.75 0 1 1 1.06 1.06L9.06 8l5.47 5.47a.75.75 0 1 1-1.06 1.06L8 9.06l-5.47 5.47a.75.75 0 0 1-1.06-1.06L6.94 8 1.47 2.53a.75.75 0 0 1 0-1.06z"></path>
			</svg>
		</button>
	</div>
`.trim()
const LyricsContainer = `<div class="LyricsContent"><div class="ContentContainer"></div></div>`

// Class
export default class CardView implements Giveable {
	// Private Properties
	private readonly Maid = new Maid()

	// Private Elements
	private readonly Container: HTMLDivElement
	private readonly Header: HTMLDivElement
	private readonly ShowLyricsButton: HTMLButtonElement
	private readonly ExpandedControls: {
		Container: HTMLDivElement;
		OpenPageButton: HTMLButtonElement;
		CloseButton: HTMLButtonElement;
	}
	// deno-lint-ignore no-explicit-any
	private readonly LyricsContainer: HTMLDivElement
	private readonly LyricsContentContainer: HTMLDivElement

	// Constructor
	constructor(insertAfter: HTMLDivElement) {
		// Handle creating our elements
		{
			// Create our container first
			this.Container = this.Maid.Give(CreateElement<HTMLDivElement>(CardContainer))
	
			// Reference our header
			this.Header = this.Container.querySelector<HTMLDivElement>(".Header")!
	
			// Create our show lyrics button
			this.ShowLyricsButton = this.Maid.Give(CreateElement<HTMLButtonElement>(ShowLyricsButton))

			// Create our expanded controls
			const expandedControlsContainer = this.Maid.Give(CreateElement<HTMLDivElement>(ExpandedControls))
			this.ExpandedControls = {
				Container: expandedControlsContainer,
				OpenPageButton: expandedControlsContainer.querySelector<HTMLButtonElement>("#Page")!,
				CloseButton: expandedControlsContainer.querySelector<HTMLButtonElement>("#Close")!,
			}

			// Create our lyrics-container
			this.LyricsContainer = this.Maid.Give(CreateElement<HTMLDivElement>(LyricsContainer))

			// Reference our lyrics-root-container
			this.LyricsContentContainer = this.LyricsContainer.querySelector<HTMLDivElement>(".ContentContainer")!
		}

		// Create our tool-tips
		{
			const closeTooltip = Spotify.Tippy(
				this.ExpandedControls.CloseButton,
				{
					...Spotify.TippyProps,
					content: `Close Lyrics`
				}
			)
			this.Maid.Give(() => closeTooltip.destroy())
			
			const pageTooltip = Spotify.Tippy(
				this.ExpandedControls.OpenPageButton,
				{
					...Spotify.TippyProps,
					content: "Open Lyrics Page"
				}
			)
			this.Maid.Give(() => pageTooltip.destroy())

		}

		// Handle our button-presses
		{
			// Handle our show lyrics button
			this.ShowLyricsButton.addEventListener(
				"click",
				() => this.SetLyricsVisibility(true)
			)

			// Handle our close button
			this.ExpandedControls.CloseButton.addEventListener(
				"click",
				() => this.SetLyricsVisibility(false)
			)

			// Handle our open page button
			this.ExpandedControls.OpenPageButton.addEventListener(
				"click",
				() => SpotifyHistory.push("/BeautifulLyrics/Page")
			)

		}

		// Handle our overall state
		this.ReactToLyricsVisibility()

		// Now parent our container
		insertAfter.after(this.Container)
	}

	// Private Methods
	private SetLyricsVisibility(visible: boolean) {
		Store.Items.CardLyricsVisible = visible
		this.ReactToLyricsVisibility()
		Store.SaveChanges()
	}

	private CreateLyricsRenderer() {
		this.Maid.Give(
			new LyricsRenderer(
				this.LyricsContentContainer, SongLyrics!
			),
			"LyricsRenderer"
		)
	}

	private ReactToLyricsVisibility() {
		// Determine if we are visible
		const isVisbile = Store.Items.CardLyricsVisible

		// Determine what is presently parented to header
		const visibleHeaderElement = isVisbile ? this.ExpandedControls.Container : this.ShowLyricsButton
		this.Header.appendChild(visibleHeaderElement)
		this.Maid.Give(() => visibleHeaderElement.remove(), "VisibleHeaderElement")

		// Determine whether or not our lyrics should be visible
		if (isVisbile) {
			// Generate our lyrics
			this.CreateLyricsRenderer()

			// Parent our container
			this.Container.appendChild(this.LyricsContainer)
		} else {
			// Unparent our container
			this.LyricsContainer.remove()

			// Destroy our lyrics renderer
			this.Maid.Clean("LyricsRenderer")
		}
	}

	// Deconstructor
	public Destroy() {
		this.Maid.Destroy()
	}
}