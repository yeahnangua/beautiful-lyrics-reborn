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
const RightSidebar = ".Root__right-sidebar"
const ContentsContainer = "aside, section.main-buddyFeed-container"
const CardInsertAnchor = ".main-nowPlayingView-nowPlayingWidget, canvas"
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

			{
				const CheckForSongExistence = () => {
					if (Song === undefined) {
						lyricsButton.deregister()
					} else {
						lyricsButton.register()
					}
				}
				ViewMaid.Give(SongChanged.Connect(CheckForSongExistence))
				ViewMaid.Give(Timeout(1, CheckForSongExistence))
			}

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
			}
			ViewMaid.Give(SongChanged.Connect(CheckForSongExistence))
			ViewMaid.Give(Timeout(1, CheckForSongExistence))
		}
	}
)
.then( // Location Handler
	() => {
		const HandleSpotifyLocation = (location: HistoryLocation) => {
			// Cancel a pending mount when navigating away or switching view types.
			ViewMaid.Clean("FindPageContainer")
			// Remove our previous page-view
			ViewMaid.Clean("PageView")

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
		let sidebar: HTMLDivElement, contentsContainer: (HTMLDivElement | undefined)
		const contentsContainerMaid = ViewMaid.Give(new Maid())
		const nowPlayingViewMaid = ViewMaid.Give(new Maid())

		// Each check method
		const CheckForNowPlaying = () => {
			// Clean-up when we are called
			nowPlayingViewMaid.CleanUp()

			// Now check to see if we have our card anchor
			const cardAnchor = contentsContainer!.querySelector<HTMLDivElement>(CardInsertAnchor)
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
				if (
					// We shouldn't be rendering the card-view when we have another of our views open
					SpotifyHistory.location.pathname.startsWith("/BeautifulLyrics")
					|| (Song === undefined)
					|| (HaveSongLyricsLoaded && (SongLyrics === undefined))
				) {
					nowPlayingViewMaid.Clean("Card")
					return
				} else if (HaveSongLyricsLoaded === false) { // Render a template if we're still loading our lyrics
					const card = nowPlayingViewMaid.Give(CreateElement<HTMLDivElement>(LoadingLyricsCard), "Card")
					cardAnchor.after(card)

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

		const CheckForContentsContainer = () => {
			// Clean-up when we are called
			contentsContainerMaid.CleanUp()
			nowPlayingViewMaid.CleanUp()

			// Determine if our contents-container even exists
			contentsContainer = (sidebar.querySelector<HTMLDivElement>(ContentsContainer) ?? undefined)
			if (contentsContainer === undefined) {
				return
			}

			// Check if there's anything we can do immediately
			CheckForNowPlaying()

			// Handle when we should check
			contentsContainerMaid.Give(SongChanged.Connect(DeferCheckForNowPlaying))

		}
		const DeferCheckForContentsContainer = () => ViewMaid.Give(Defer(CheckForContentsContainer), "CheckForContentsContainer")

		const CheckForSidebar = () => {
			// Check for our sidebar existing
			const newSidebar = document.querySelector<HTMLDivElement>(RightSidebar)
			if (newSidebar === null) {
				ViewMaid.Give(Defer(CheckForSidebar), "CheckForSidebar")
				return
			}
			sidebar = newSidebar

			// Create our observer
			const sidebarChildObserver = ViewMaid.Give(new MutationObserver(DeferCheckForContentsContainer))

			// Check if there's anything we can do immediately
			CheckForContentsContainer()

			// Observe our elements
			sidebarChildObserver.observe(sidebar, { childList: true })
			for (const element of sidebar.children) {
				if (
					(element instanceof HTMLDivElement)
					&& ((element.children.length === 0) || (element.querySelector(ContentsContainer) !== null))
				) {
					sidebarChildObserver.observe(element, { childList: true })
				}
			}
		}
		CheckForSidebar()
	}
)
.then( // Spotify Fullscreen Button Removal
	() => {
		const SearchDOM = () => {
			const controlsContainer = document.querySelector<HTMLButtonElement>(".main-nowPlayingBar-extraControls")
			if (controlsContainer === null) {
				ViewMaid.Give(Defer(SearchDOM))
			} else {
				for (const element of controlsContainer.children) {
					if (
						(element.attributes.getNamedItem("data-testid")?.value === "fullscreen-mode-button")
						&& (element.id !== "BeautifulLyricsFullscreenButton")
					) {
						(element as HTMLElement).style.display = "none"
					}
				}
			}
		}
		SearchDOM()
	}
)
