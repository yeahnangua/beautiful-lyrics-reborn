// NPM Packages
import seedrandom from "npm:seedrandom"

import { BackgroundRenderer } from "./BackgroundRenderer.ts"

// Web-Modules
import { Signal } from "@Universal/Modules/Signal.ts"
import type { Maid } from "@Universal/Modules/Maid.ts"

// Spices
import { GetInstantStore } from "@Spices/Spicetify/Services/Cache.ts"
import {
	Song, SongChanged,
	SongContext, SongContextChanged
} from "@Spices/Spicetify/Services/Player/mod.ts"



// Our store
export const Store = GetInstantStore<
	{
		CardLyricsVisible: boolean;
		PlaybarDetailsHidden: boolean;
	}
>(
	"BeautifulLyrics/LyricViews", 1,
	{
		CardLyricsVisible: false,
		PlaybarDetailsHidden: false,
	}
)

// Retire removed preferences while preserving the remaining view settings.
const ViewSettingNames = new Set(["CardLyricsVisible", "PlaybarDetailsHidden"])
let settingsChanged = false
for (const key of Object.keys(Store.Items)) {
	if (!ViewSettingNames.has(key)) {
		delete (Store.Items as Record<string, unknown>)[key]
		settingsChanged = true
	}
}
if (settingsChanged) Store.SaveChanges()

// Shared Methods
export const CreateElement = <E = HTMLElement>(text: string) => {
	const element = document.createElement("div")
	element.innerHTML = text
	return element.firstElementChild as E
}

// Handle applying our dynamic-background
const BackgroundClassName = "BeautifulLyricsBackground"
const PlaceholderCoverArt = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#6649a8"/><circle cx="160" cy="80" r="110" fill="#a76d8e"/></svg>')}`

export const GetCoverArtForSong = (): [string, (number | undefined)] => {
	const coverArt = Song?.Type === "Local"
		? (Song.CoverArt || SongContext?.CoverArt)
		: (Song?.CoverArt.Big || Song?.CoverArt.Large || Song?.CoverArt.Default || Song?.CoverArt.Small)
	if (coverArt) {
		// Spotify's desktop image scheme cannot be decoded with CORS for a WebGL texture.
		const imageId = /^(?:spotify:image:)?([a-f0-9]{40})$/i.exec(coverArt)?.[1]
		return [imageId ? `https://i.scdn.co/image/${imageId.toLowerCase()}` : coverArt, undefined]
	}

	return [PlaceholderCoverArt, 75 + (360 - 75) * seedrandom(Song?.Uri)()]
}

// Blurred Cover Art Generation
let Blurred_CovertArt: OffscreenCanvas
let coverArtRequest = 0
const CoverArtBlurred = new Signal()
const GenerateBlurredCoverArt = async () => {
	const request = ++coverArtRequest
	const [coverArt, placeholderHueShift] = GetCoverArtForSong()

	const image = new Image()
	image.crossOrigin = "anonymous"
	image.src = coverArt
	try {
		await image.decode()
	} catch {
		if (request !== coverArtRequest || coverArt === PlaceholderCoverArt) return
		image.src = PlaceholderCoverArt
		try { await image.decode() } catch { return }
	}
	if (request !== coverArtRequest) return

	const originalSize = Math.min(image.width, image.height) // Crop to a square
	const blurExtent = Math.ceil(3 * 40) // Blur spread extent

	// Create a square canvas to crop the image into a circle
	const circleCanvas = new OffscreenCanvas(originalSize, originalSize)
	const circleCtx = circleCanvas.getContext('2d')!

	// Create circular clipping mask
	circleCtx.beginPath()
	circleCtx.arc(originalSize / 2, originalSize / 2, originalSize / 2, 0, Math.PI * 2)
	circleCtx.closePath()
	circleCtx.clip()

	// Draw the original image inside the circular clip
	circleCtx.drawImage(
		image,
		((image.width - originalSize) / 2), ((image.height - originalSize) / 2),
		originalSize, originalSize,
		0, 0,
		originalSize, originalSize
	)

	// Expand canvas to accommodate blur effect
	const padding = (blurExtent * 1.5)
	const expandedSize = originalSize + padding
	const blurredCanvas = new OffscreenCanvas(expandedSize, expandedSize)
	const blurredCtx = blurredCanvas.getContext('2d')!

	blurredCtx.filter = `hue-rotate(${placeholderHueShift ?? 0}deg) blur(${40}px)`

	// Draw the cropped circular image in the center of the expanded canvas
	blurredCtx.drawImage(circleCanvas, (padding / 2), (padding / 2))

	Blurred_CovertArt = blurredCanvas
	CoverArtBlurred.Fire()
}
GenerateBlurredCoverArt()
SongChanged.Connect(GenerateBlurredCoverArt)
SongContextChanged.Connect(GenerateBlurredCoverArt) // We might use Playlist cover instead

export const ApplyDynamicBackground = (element: HTMLElement, maid: Maid) => {
 element.classList.add(BackgroundClassName)
 maid.Give(() => element.classList.remove(BackgroundClassName))
 let renderer: BackgroundRenderer
 try { renderer = new BackgroundRenderer() } catch { return }
 const canvas = renderer.canvas
 canvas.classList.add(BackgroundClassName + '-Container')
 element.prepend(canvas); maid.Give(canvas)
 let active = true, visible = true, frame: number | undefined
 const stop = () => { if (frame !== undefined) cancelAnimationFrame(frame); frame = undefined }
 const render = () => {
   frame = undefined
   if (!active || !visible || document.hidden || !element.isConnected) return
   renderer.render()
   frame = requestAnimationFrame(render)
 }
 const update = () => {
   stop()
   if (!active || !visible || document.hidden) return
   renderer.resize(element.clientWidth, element.clientHeight)
   if (Blurred_CovertArt) { try { renderer.setImage(Blurred_CovertArt) } catch { return } }
   render()
 }
 const observer = maid.Give(new ResizeObserver(update)); observer.observe(element)
 const visibility = maid.Give(new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); update() }))
 visibility.observe(element)
 document.addEventListener('visibilitychange', update)
 maid.Give(CoverArtBlurred.Connect(update))
 maid.Give(() => { active = false; stop(); document.removeEventListener('visibilitychange', update); renderer.destroy() })
 update()
}
