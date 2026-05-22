// Stylings
import './Stylings/main.scss'

// NPM Packages
import { bindKeyCombo, unbindKeyCombo } from "npm:@rwh/keystrokes"

// Build Spices
import { UpdateNoticeConfiguration } from "@Spices/AutoUpdate/UpdateNotice.ts"

// Spices
import {
	GlobalMaid,
	OnSpotifyReady, Spotify,
	SpotifyInternalFetch,
	ShowNotification
} from "@Spices/Spicetify/Services/Session.ts"

// Singletons
import "./LyricViews/mod.ts"

// Shared Methods
import { CreateElement } from "./LyricViews/Shared.ts"

const Load = async () => {
	{
		const fontPromises: Promise<FontFaceSet>[] = []
		const fonts = [
			new FontFace(
				"BeautifulLyrics",
				"url(https://fonts.socalifornian.live/LyricsRegular.woff2)",
				{
					weight: "400",
					style: "normal"
				}
			),
			new FontFace(
				"BeautifulLyrics",
				"url(https://fonts.socalifornian.live/LyricsMedium.woff2)",
				{
					weight: "500",
					style: "normal"
				}
			),
			new FontFace(
				"BeautifulLyrics",
				"url(https://fonts.socalifornian.live/LyricsSemibold.woff2)",
				{
					weight: "600",
					style: "normal"
				}
			),
			new FontFace(
				"BeautifulLyrics",
				"url(https://fonts.socalifornian.live/LyricsBold.woff2)",
				{
					weight: "700",
					style: "normal"
				}
			)
		]
		for (const font of fonts) {
			fontPromises.push(
				font.load().then(font => document.fonts.add(font))
			)
		}
		await Promise.all(fontPromises)
	}

	await OnSpotifyReady

	// Custom text rendering, still expirementing so not final yet
	{
		/*const canvas = GlobalMaid.Give(CreateElement<HTMLCanvasElement>("<canvas></canvas>"))
		canvas.style.backgroundColor = "rgba(255, 255, 255, 0.5)"
		canvas.style.pointerEvents = "none"
		canvas.style.width = `${document.body.clientWidth}px`
		canvas.style.height = `${document.body.clientHeight}px`
		canvas.width = document.body.clientWidth
		canvas.height = document.body.clientHeight
		canvas.style.position = "absolute"
		canvas.style.top = "0"
		canvas.style.left = "0"
		canvas.style.zIndex = "100000"
		document.body.appendChild(canvas)

		const dpr = globalThis.devicePixelRatio
		canvas.width *= dpr
		canvas.height *= dpr

		const context = canvas.getContext("2d")!
		context.scale(dpr, dpr)
		context.font = `bold 125px "BeautifulLyrics"`

		context.lineWidth = 1
		context.beginPath()
		context.moveTo(100, 100)
		context.lineTo(100, 200)
		context.stroke()
		context.closePath()

		const text = "Hello World!"
		
		const bound = context.measureText(text)
		const gradient = context.createLinearGradient(100, 0, 100 + (bound.actualBoundingBoxLeft + bound.actualBoundingBoxRight), 0)
		gradient.addColorStop(0, "rgba(255, 255, 255, 1)")
		gradient.addColorStop(0.25, "rgba(255, 255, 255, 1)")
		gradient.addColorStop(0.5, "rgba(255, 255, 255, 0.75)")
		gradient.addColorStop(0.75, "rgba(255, 255, 255, 0.5)")
		gradient.addColorStop(1, "rgba(255, 255, 255, 0)")
		context.fillStyle = gradient

		context.shadowColor = "rgba(255, 255, 255, 1)"
		context.shadowBlur = 30
		context.fillText(text, 100, 180)

		const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" })
		let measure_String = ""
		for(const segment of []) {//segmenter.segment(text)) {
			measure_String += segment.segment
			if (segment.segment === " ") {
				continue
			}

			const measureBounds = context.measureText(measure_String)
			context.fillStyle = `rgba(${
			Math.floor(Math.random() * 255)
			}, ${Math.floor(Math.random() * 255)}, ${
			Math.floor(Math.random() * 255)
			}, 1)`
			context.beginPath()
			context.rect(
				100 - measureBounds.actualBoundingBoxLeft,
				180,// + (50 * (measure_String.length - 1)),
				(measureBounds.actualBoundingBoxRight + measureBounds.actualBoundingBoxLeft),
				(measureBounds.actualBoundingBoxAscent + measureBounds.actualBoundingBoxDescent)
			)
			context.fill()
			context.closePath()
			console.log(measureBounds, context.measureText(segment.segment))

			const segmentBounds = context.measureText(segment.segment)
			const segmentWidth = (segmentBounds.actualBoundingBoxRight + segmentBounds.actualBoundingBoxLeft)

			context.fillStyle = `rgba(${
			Math.floor(Math.random() * 255)
			}, ${Math.floor(Math.random() * 255)}, ${
			Math.floor(Math.random() * 255)
			}, 0.5`
			context.beginPath()
			context.rect(
				(
					100 - measureBounds.actualBoundingBoxLeft
					+ (measureBounds.actualBoundingBoxRight + measureBounds.actualBoundingBoxLeft)
					- (segmentBounds.actualBoundingBoxRight + segmentBounds.actualBoundingBoxLeft)
				),
				180 - (segmentBounds.actualBoundingBoxAscent + segmentBounds.actualBoundingBoxDescent),
				segmentWidth,
				(segmentBounds.actualBoundingBoxAscent + segmentBounds.actualBoundingBoxDescent)
			)
			context.fill()
			context.closePath()

			context.fillStyle = "grey"
			context.fillText(
				segment.segment,
				(
					100 - measureBounds.actualBoundingBoxLeft
					+ (measureBounds.actualBoundingBoxRight + measureBounds.actualBoundingBoxLeft)
					- (segmentBounds.actualBoundingBoxRight + segmentBounds.actualBoundingBoxLeft)
					+ segmentBounds.actualBoundingBoxLeft
				),
				190
			)
		}*/

		/*const HBounds = context.measureText("H")
		const eBounds = context.measureText("e")
		const HeBounds = context.measureText("He")

		const HeWidth = (HeBounds.actualBoundingBoxRight + HeBounds.actualBoundingBoxLeft)
		const HWidth = (HBounds.actualBoundingBoxRight + HBounds.actualBoundingBoxLeft)
		const eWidth = (eBounds.actualBoundingBoxRight + eBounds.actualBoundingBoxLeft)

		context.fillStyle = "rgba(0, 0, 0, 0.5)"
		context.rect(
			100 - HBounds.actualBoundingBoxLeft,
			180 - HBounds.actualBoundingBoxAscent,
			HBounds.actualBoundingBoxRight + HBounds.actualBoundingBoxLeft,
			HBounds.actualBoundingBoxAscent + HBounds.actualBoundingBoxDescent
		)
		context.fill()
		context.fillStyle = "rgba(0, 0, 255, 0.5)"
		const eRelativePositionX = HeWidth - eWidth - HeBounds.actualBoundingBoxLeft
		context.rect(
			100 + eRelativePositionX,
			180 - eBounds.actualBoundingBoxAscent,
			eBounds.actualBoundingBoxRight + eBounds.actualBoundingBoxLeft,
			eBounds.actualBoundingBoxAscent + eBounds.actualBoundingBoxDescent
		)
		context.fill()

		const spaceBetweenHande = (eRelativePositionX - HWidth + HBounds.actualBoundingBoxLeft)
		context.fillStyle = "rgba(255, 0, 0, 0.5)"
		context.rect(
			100 - HBounds.actualBoundingBoxLeft + HWidth,
			180 - eBounds.actualBoundingBoxAscent,
			spaceBetweenHande,
			HBounds.actualBoundingBoxAscent + HBounds.actualBoundingBoxDescent
		)
		context.fill()

		context.fillStyle = "grey"
		context.fillText(
			"H",
			100,
			200
		)
		context.fillText(
			"e",
			100 - HBounds.actualBoundingBoxLeft + HWidth + spaceBetweenHande + eBounds.actualBoundingBoxLeft,
			200
		)*/
	}

	{ // Handle our Debugging (gives Linux an opportunity to get this information)
		const OnGetSpotifyAndSpicetifyInformation = () => {
			SpotifyInternalFetch.get("sp://desktop/v1/version")
			.catch(
				(error) => ShowNotification(`Failed to Copy Spotify/Spicetify Information (${error})`, "error", 10)
			)
			.then(
				(
					response: {
						buildSystemID: string;
						buildType: string;
						cefRuntime: string;
						cefVersion: string;
						platform: string;
						version: string;
					}
				) => {
					const informationFormat = `
						Spotify Version: ${response.version}
						Spotify Runtime: ${response.cefVersion}
						Spicetify Version: ${Spotify.Config.version}
						Spicetify Theme: ${Spotify.Config.current_theme}${
							(Spotify.Config.color_scheme.length === 0) ? "" : ` / ${Spotify.Config.color_scheme}`
						}
						Spicetify Extensions: [${Spotify.Config.extensions.join(", ")}]
						Spicetify Custom Apps: [${Spotify.Config.custom_apps.join(", ")}]
					`.trim().replace(/\t/g, "")
					{
						navigator.clipboard.writeText(informationFormat)
						.catch(
							(error) => ShowNotification(`Failed to Copy Spotify/Spicetify Information (${error})`, "error", 10)
						)
						.then(
							() => ShowNotification("Copied Spotify/Spicetify Information", "success", 5)
						)
					}
				}
			)
			
		}
		bindKeyCombo("shift+b+l>i", OnGetSpotifyAndSpicetifyInformation)
		GlobalMaid.Give(() => unbindKeyCombo("shift+b+l>i", OnGetSpotifyAndSpicetifyInformation))
	
		// Create our reusable link element (for saving)
		const linkElement = CreateElement<HTMLLinkElement & { download: string }>(`<a></a>`)
		const SaveContentToFile = (downloadName: string, content: string, contentType: string) => {
			const jsonBlob = new Blob([content], { type: contentType })
			const url = URL.createObjectURL(jsonBlob)
			linkElement.download = downloadName
			linkElement.href = url
			linkElement.click()
			URL.revokeObjectURL(url)
		}

		// Handle file-saving
		const OnSaveSpotifyHTML = () => SaveContentToFile("Spotify.html", document.documentElement.innerHTML, "text/html")
		const OnSaveSpotifyCSS = () => (
			fetch("xpui.css")
			.then((response) => response.text())
			.then(text => SaveContentToFile("Spotify.css", text, "text/css"))
			.catch((error) => ShowNotification(`Failed to Save Spotify CSS (${error})`, "error", 10))
		)
		bindKeyCombo("shift+b+l>h", OnSaveSpotifyHTML)
		bindKeyCombo("shift+b+l>c", OnSaveSpotifyCSS)
		GlobalMaid.GiveItems(
			() => unbindKeyCombo("shift+b+l>h", OnSaveSpotifyHTML),
			() => unbindKeyCombo("shift+b+l>c", OnSaveSpotifyCSS)
		)
	}

}
Load()

// Finally, return our maid and also return our UpdateNotificationDetailer
export const UpdateNotice: UpdateNoticeConfiguration = {
	Type: "Notification",
	Name: "Beautiful Lyrics Reborn"
}
export default GlobalMaid
