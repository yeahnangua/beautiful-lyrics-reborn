// Spotify can ship unmapped CSS classes before Spicetify catches up. Prefer
// semantic anchors when its legacy playback/sidebar selectors are unavailable.
export const FindPlaybarControls = (root: Document = document): HTMLElement | null => (
	root.querySelector<HTMLElement>(".main-nowPlayingBar-extraControls")
	?? root.querySelector<HTMLElement>('[data-testid="now-playing-bar"] [data-testid="control-button-queue"]')?.parentElement?.parentElement
	?? null
)

export const BindPlaybarElements = (buttons: HTMLButtonElement[], visible: () => boolean) => {
	const hidden = new Map<HTMLElement, string>()
	const mount = () => {
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
	const observer = new MutationObserver(mount)
	observer.observe(document.body, { childList: true, subtree: true })
	mount()
	return {
		Update: mount,
		Destroy() {
			observer.disconnect()
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
