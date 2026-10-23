// Styles
import "./style.scss"
import "../Stylings/Views.scss"

// Imported Types
import Spicetify from "@Spices/Spicetify/Types/App/Spicetify.ts"

// NPM Packages
import { checkKey } from "npm:@rwh/keystrokes"

// Web Modules
import { Maid } from "@Universal/Modules/Maid.ts"
import { Defer, Timeout } from "@Universal/Modules/Scheduler.ts"

// Spices
import {
	GlobalMaid,
	OnSpotifyReady,
	HistoryLocation, SpotifyHistory, SpotifyPlaybar
} from "@Spices/Spicetify/Services/Session.ts"
import {
	Song, SongChanged,
	SongLyrics, SongLyricsLoaded, HaveSongLyricsLoaded
} from "@Spices/Spicetify/Services/Player/mod.ts"

// Components
import CardView from "./Card/mod.ts"
import ContainedPageView from "./Page/Contained.ts"
import FullscreenPageView from "./Page/Fullscreen.ts"

// Our Modules
import { CreateElement, ApplyDynamicBackground } from "./Shared.ts"
import Icons from "./Icons.ts"
import { MeasureLyricsDisplay, CancelLyricsDisplay } from "../Modules/Metrics.ts"
import { BindNowPlayingContents, BindPlaybarElements, FindNowPlayingAnchor } from "./DOM.ts"

// Create our maid
const ViewMaid = GlobalMaid.Give(new Maid())

// Template Constants
const LoadingLyricsCard = `<div class="LoadingLyricsCard Loading"></div>`

// DOM Search Constants
// Spotify 1.3.3 can leave the root class unmapped on Windows; the ID is stable.
const MainView = ":is(#main-view, .Root__main-view)"
const CurrentMainPage = `${MainView} .main-view-container div[data-overlayscrollbars-viewport]`
const LegacyMainPage = `${MainView} .main-view-container .os-host`
const NativeMainPage = `${MainView} .main-view-container__scroll-node`
const SpotifyCardViewQuery = ".main-nowPlayingView-section:not(:is(#BeautifulLyrics-CardView)):has(.main-nowPlayingView-lyricsTitle)"

// Store our internal utilities
let SetPlaybarPageIconActiveState: (isActive: boolean) => void
let ActivePageView: (ContainedPageView | FullscreenPageView | undefined)

// Wait for Spotify to start our processing
OnSpotifyReady
.then( // Playbar Icons
	() => {
		// Store references for our buttons
		let lyricsButton: Spicetify.Playbar.Button
		let fullscreenButton: Spicetify.Playbar.Button

		// Lyrics Button
		{
			lyricsButton = new SpotifyPlaybar.Button(
				"Lyrics Page",
				Icons.LyricsPage,
				() => {
					if (ActivePageView === undefined) {
						SpotifyHistory.push(`/BeautifulLyrics/${checkKey("shift") ? "Fullscreen" : "Page"}`)
					} else {
						ActivePageView.Close()
						ActivePageView = undefined
					}
				},
				false, false
			)
			ViewMaid.Give(() => lyricsButton.deregister())

			lyricsButton.element.id = "BeautifulLyricsPageButton"
			SetPlaybarPageIconActiveState = (isActive: boolean) => {
				lyricsButton.active = isActive
				lyricsButton.element.setAttribute("aria-pressed", String(isActive))
			}
			SetPlaybarPageIconActiveState(false)
		}

		// Fullscreen Button
		{
			fullscreenButton = new SpotifyPlaybar.Button(
				"Enter Fullscreen",
				Icons.FullscreenOpen,
				() => SpotifyHistory.push(
					{
						pathname: "/BeautifulLyrics/Fullscreen",
						search: "",
						hash: "",
						state: {
							FromPlaybar: true
						}
					}
				),
				false,
				false
			)
			ViewMaid.Give(() => fullscreenButton.deregister())
	
			// Mark our fullscreen-button and force it to the right
			fullscreenButton.element.style.order = "100000"
			fullscreenButton.element.id = "BeautifulLyricsFullscreenButton"
		}
		for (const button of [lyricsButton, fullscreenButton]) {
			button.element.classList.add("BeautifulLyrics-PlaybarButton")
			button.element.setAttribute("aria-label", button.label)
		}
		const playbarElements = ViewMaid.Give(BindPlaybarElements(
			[lyricsButton.element, fullscreenButton.element], () => Song !== undefined
		))

		// Handle removing our buttons if we DON'T have a song
		{
			const CheckForSongExistence = () => {
				if (Song === undefined) {
					lyricsButton.deregister()
					fullscreenButton.deregister()
				} else {
					lyricsButton.register()
					fullscreenButton.register()
				}
				playbarElements.Update()
			}
			ViewMaid.Give(SongChanged.Connect(CheckForSongExistence))
			ViewMaid.Give(Timeout(1, CheckForSongExistence))
		}
	}
)
.then( // Location Handler
	() => {
		const HandleSpotifyLocation = (location: HistoryLocation) => {
			// A repeated entry must not restart an in-flight fullscreen download.
			if (location.pathname === "/BeautifulLyrics/Fullscreen" && ActivePageView instanceof FullscreenPageView) return
			// Cancel a pending mount when navigating away or switching view types.
			ViewMaid.Clean("FindPageContainer")
			// Remove our previous page-view
			ViewMaid.Clean("PageView")
			CancelLyricsDisplay("page")
			CancelLyricsDisplay("fullscreen")

			// Now handle our page-view
			if (location.pathname === "/BeautifulLyrics/Page") {
				const MountPage = () => {
					if (SpotifyHistory.location.pathname !== "/BeautifulLyrics/Page") return
					const current = document.querySelector<HTMLDivElement>(CurrentMainPage)
					const legacy = current ? null : document.querySelector<HTMLDivElement>(LegacyMainPage)
					const page = current ?? legacy ?? document.querySelector<HTMLDivElement>(NativeMainPage)
					if (page === null) {
						ViewMaid.Give(Defer(MountPage), "FindPageContainer")
						return
					}
					SetPlaybarPageIconActiveState(true)
					ActivePageView = ViewMaid.Give(new ContainedPageView(page, legacy !== null), "PageView")
					ActivePageView.Closed.Connect(() => SetPlaybarPageIconActiveState(false))
					ActivePageView.Closed.Connect(() => ActivePageView = undefined)
				}
				MountPage()
			} else if (location.pathname === "/BeautifulLyrics/Fullscreen") {
				ActivePageView = ViewMaid.Give(new FullscreenPageView(location.state?.FromPlaybar), "PageView")
				ActivePageView.Closed.Connect(() => ActivePageView = undefined)
			}
		}

		// Fullscreen mounts to the body and must not wait for a contained-page viewport.
		ViewMaid.Give(SpotifyHistory.listen(HandleSpotifyLocation))
		HandleSpotifyLocation(SpotifyHistory.location)
	}
)
.then( // Right Side-bar/Card View
	() => {
		// Store our state
		let contentsContainer: HTMLDivElement | undefined
		let observedCardAnchor: HTMLDivElement | null = null
		const contentsContainerMaid = ViewMaid.Give(new Maid())
		const nowPlayingViewMaid = ViewMaid.Give(new Maid())

		// Each check method
		const CheckForNowPlaying = () => {
			// Clean-up when we are called
			nowPlayingViewMaid.CleanUp()

			// Now check to see if we have our card anchor
			const cardAnchor = observedCardAnchor = FindNowPlayingAnchor(contentsContainer!)
			if (cardAnchor === null) {
				return
			}

			// Immediately add our class to the top container
			const backgroundMaid = nowPlayingViewMaid.Give(new Maid())
			let backgroundApplied = false
			const CheckDynamicBackground = () => {
				if (SpotifyHistory.location.pathname === "/BeautifulLyrics/Fullscreen") {
					backgroundMaid.CleanUp()
					backgroundApplied = false
				} else if (backgroundApplied === false) {
					backgroundApplied = true
					ApplyDynamicBackground(contentsContainer!, backgroundMaid)
				}
			}
			CheckDynamicBackground()
			nowPlayingViewMaid.Give(SpotifyHistory.listen(CheckDynamicBackground))

			// Now we can monitor for Spotifys lyrics card (and hide it)
			const cardContainer = cardAnchor.parentElement!
			const CheckForLyricsCard = () => {
				const cardView = cardContainer.querySelector<HTMLDivElement>(SpotifyCardViewQuery)
				if (cardView !== null) {
					cardView.style.display = "none"
				}
			}
			CheckForLyricsCard()
			const containerObserver = nowPlayingViewMaid.Give(new MutationObserver(CheckForLyricsCard))
			containerObserver.observe(cardContainer, { childList: true })

			// Also handle our own card
			const ShouldCreateCard = () => {
				nowPlayingViewMaid.Clean("CardLoadingMeasurement")
				if (
					// We shouldn't be rendering the card-view when we have another of our views open
					SpotifyHistory.location.pathname.startsWith("/BeautifulLyrics")
					|| (Song === undefined)
					|| (HaveSongLyricsLoaded && (SongLyrics === undefined))
				) {
					nowPlayingViewMaid.Clean("Card")
					CancelLyricsDisplay("card")
					return
				} else if (HaveSongLyricsLoaded === false) { // Render a template if we're still loading our lyrics
					const card = nowPlayingViewMaid.Give(CreateElement<HTMLDivElement>(LoadingLyricsCard), "Card")
					cardAnchor.after(card)
					nowPlayingViewMaid.Give(MeasureLyricsDisplay(card, "card"), "CardLoadingMeasurement")

					return
				}

				nowPlayingViewMaid.Give(new CardView(cardAnchor), "Card")
			}
			ShouldCreateCard()
			nowPlayingViewMaid.GiveItems(
				SongLyricsLoaded.Connect(ShouldCreateCard),
				SpotifyHistory.listen(ShouldCreateCard)
			)
		}
		const DeferCheckForNowPlaying = () => ViewMaid.Give(Defer(CheckForNowPlaying), "CheckForNowPlaying")

		const CheckForContentsContainer = (contents: HTMLDivElement | undefined) => {
			// Clean-up when we are called
			ViewMaid.Clean("CheckForNowPlaying")
			contentsContainerMaid.CleanUp()
			nowPlayingViewMaid.CleanUp()

			// Determine if our contents-container even exists
			contentsContainer = contents
			if (contentsContainer === undefined) {
				return
			}

			// Check if there's anything we can do immediately
			CheckForNowPlaying()
			// The new NPV root may arrive before its scroll content or replace that
			// content without replacing the sidebar itself.
			const contentsObserver = contentsContainerMaid.Give(new MutationObserver(() => {
				if (!observedCardAnchor?.isConnected) DeferCheckForNowPlaying()
			}))
			contentsObserver.observe(contentsContainer, { childList: true, subtree: true })

			// Handle when we should check
			contentsContainerMaid.Give(SongChanged.Connect(DeferCheckForNowPlaying))

		}
		ViewMaid.Give(BindNowPlayingContents(CheckForContentsContainer))
	}
)
