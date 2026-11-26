const rootSubscribers = new Set<() => void>()
let rootObserver: MutationObserver | undefined, rootFrame: number | undefined
const ObserveSpotifyRoot = (callback: () => void) => {
 rootSubscribers.add(callback)
 if (!rootObserver) {
  rootObserver = new MutationObserver(records => {
    const anchor = '.main-nowPlayingBar-extraControls,[data-testid="now-playing-bar"],.Root__right-sidebar,#Desktop_PanelContainer_Id'
    const related = records.some(record => record.target instanceof Element && record.target.closest(anchor)
      || [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && (node.matches(anchor) || node.querySelector(anchor))))
    if (related && rootFrame === undefined) rootFrame = requestAnimationFrame(() => { rootFrame = undefined; for (const update of rootSubscribers) update() })
  })
  rootObserver.observe(document.body, {childList:true,subtree:true})
 }
 return () => { rootSubscribers.delete(callback); if (!rootSubscribers.size) { rootObserver?.disconnect();rootObserver=undefined;if(rootFrame!==undefined)cancelAnimationFrame(rootFrame);rootFrame=undefined } }
}
// Spotify can ship unmapped CSS classes before Spicetify catches up. Prefer
// semantic anchors when its legacy playback/sidebar selectors are unavailable.
export const FindPlaybarControls = (root: Document = document): HTMLElement | null => {
	const legacy = root.querySelector<HTMLElement>(".main-nowPlayingBar-extraControls")
	if (legacy) return legacy
	const bar = root.querySelector<HTMLElement>('[data-testid="now-playing-bar"]')
	const queue = bar?.querySelector<HTMLElement>('[data-testid="control-button-queue"]')
	// Queue/Jam can add nested wrappers with overlap masks. Find the shared
	// control row using its volume/fullscreen siblings, not a fixed parent count.
	for (let controls = queue?.parentElement; controls && controls !== bar; controls = controls.parentElement) {
		if (controls.querySelector('[data-testid="volume-bar"], [data-testid="fullscreen-mode-button"], [data-testid="pip-toggle-button"]')) return controls
	}
	return null
}

export const BindPlaybarElements = (buttons: HTMLButtonElement[], visible: () => boolean) => {
	const hidden = new Map<HTMLElement, string>()
	const mount = () => {
		for (const node of hidden.keys()) if (!node.isConnected) hidden.delete(node)
		if (!visible()) return
		const controls = FindPlaybarControls()
		if (!controls) return
		for (const button of buttons) {
			if (button.parentElement !== controls) controls.prepend(button)
		}
		const nativeFullscreen = controls.querySelector<HTMLElement>('[data-testid="fullscreen-mode-button"]')
		if (nativeFullscreen && !buttons.includes(nativeFullscreen as HTMLButtonElement)) {
			if (!hidden.has(nativeFullscreen)) hidden.set(nativeFullscreen, nativeFullscreen.style.display)
			nativeFullscreen.style.display = "none"
		}
	}
	const stop = ObserveSpotifyRoot(mount)
	mount()
	return {
		Update: mount,
		Destroy() {
			stop()
			for (const [element, display] of hidden) element.style.display = display
		},
	}
}

export const FindNowPlayingAnchor = (contents: HTMLElement): HTMLDivElement | null => {
	const legacy = contents.querySelector<HTMLDivElement>(".main-nowPlayingView-nowPlayingWidget, canvas")
	if (legacy) return legacy
	const viewport = contents.querySelector<HTMLElement>("[data-overlayscrollbars-viewport]")
	// Cover-art links may precede the title widget; only the title has text.
	let anchor: HTMLElement | undefined = Array.from(viewport?.querySelectorAll<HTMLAnchorElement>('a[href^="/album/"]') ?? [])
		.find(link => link.textContent?.trim())
	// The song information precedes Spotify's lyrics/about sections. Stop inside
	// the scroll viewport instead of depending on hashed classes or parent counts.
	while (anchor && anchor !== viewport) {
		if (anchor instanceof HTMLDivElement && anchor.nextElementSibling?.querySelector('h2, [role="heading"]')) return anchor
		anchor = anchor.parentElement ?? undefined
	}
	return null
}

export const BindNowPlayingContents = (changed: (contents: HTMLDivElement | undefined) => void): (() => void) => {
	let previous: HTMLDivElement | undefined
	const update = () => {
		const sidebar = document.querySelector(':is(.Root__right-sidebar, #Desktop_PanelContainer_Id)')
		const contents = sidebar?.querySelector<HTMLDivElement>('[data-npv-root], aside, section.main-buddyFeed-container') ?? undefined
		if (contents === previous) return
		previous = contents
		changed(contents)
	}
	const stop = ObserveSpotifyRoot(update)
	update()
	return () => stop()
}
