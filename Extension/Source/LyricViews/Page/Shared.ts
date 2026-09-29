// Web-Modules
import { Maid } from "@Universal/Modules/Maid.ts"

// Spices
import {
	SongChanged,
	SongLyrics, SongLyricsLoaded, HaveSongLyricsLoaded, RetrySongLyricsIfMissing
} from "@Spices/Spicetify/Services/Player/mod.ts"

// Modules
import LyricsRenderer from "../../Modules/LyricsRenderer.ts"

// Our Modules
import Icons from "./Icons.ts"
import { CreateElement } from "../Shared.ts"

// Shared Lyrics Behavior
export const CreateLyricsRenderer = (
	container: HTMLDivElement,
	maid: Maid,
	noLyricsTemplate?: string,
) => {
	RetrySongLyricsIfMissing()
	const UpdateLyricsRenderer = () => {
		// Wipe our previous renderer
		maid.Clean("LyricsRenderer")

		// If we don't have lyrics we need to display that
		if (HaveSongLyricsLoaded === false) {
			if (noLyricsTemplate === undefined) {
				container.classList.remove("NoLyrics")
			}

			container.appendChild(maid.Give(CreateElement<HTMLElement>(Icons.LoadingLyrics), "LyricsRenderer"))
		} else if (SongLyrics === undefined) {
			if (noLyricsTemplate === undefined) {
				container.classList.add("NoLyrics")
			} else {
				container.appendChild(maid.Give(CreateElement<HTMLSpanElement>(noLyricsTemplate), "LyricsRenderer"))
			}
		} else { // Otherwise, render our lyrics
			if (noLyricsTemplate === undefined) {
				container.classList.remove("NoLyrics")
			}

			maid.Give(
				new LyricsRenderer(container, SongLyrics),
				"LyricsRenderer"
			)
		}
	}
	UpdateLyricsRenderer()
	maid.Give(SongChanged.Connect(UpdateLyricsRenderer))
	maid.Give(SongLyricsLoaded.Connect(UpdateLyricsRenderer))

	// Return the refresh method for other view controls.
	return UpdateLyricsRenderer
}
