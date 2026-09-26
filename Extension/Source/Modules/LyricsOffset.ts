// Web-Modules
import { Signal } from "@Universal/Modules/Signal.ts"

// Spices
import { GetInstantStore } from "@Spices/Spicetify/Services/Cache.ts"
import { Song, SongChanged } from "@Spices/Spicetify/Services/Player/mod.ts"

// Our store (offsets are remembered per-song since sync errors come from the lyrics source)
const Store = GetInstantStore<
	{
		SongOffsets: Record<string, number>;
	}
>(
	"BeautifulLyrics/LyricsOffset", 1,
	{
		SongOffsets: {}
	}
)

// Constants
export const LyricsOffsetStep = 0.2

// Signals
const LyricsOffsetChangedSignal = new Signal<(offset: number) => void>()
export const LyricsOffsetChanged = LyricsOffsetChangedSignal.GetEvent()
SongChanged.Connect(() => LyricsOffsetChangedSignal.Fire(GetLyricsOffset()))

// Methods
export const GetLyricsOffset = (): number => (
	(Song === undefined) ? 0
	: (Store.Items.SongOffsets[Song.Uri] ?? 0)
)

export const SetLyricsOffset = (offset: number) => {
	if (Song === undefined) {
		return
	}

	// Avoid floating-point drift from repeated stepping
	const roundedOffset = (Math.round(offset * 1000) / 1000)
	if (roundedOffset === GetLyricsOffset()) {
		return
	}

	// Only store non-zero offsets so our store doesn't grow with untouched songs
	if (roundedOffset === 0) {
		delete Store.Items.SongOffsets[Song.Uri]
	} else {
		Store.Items.SongOffsets[Song.Uri] = roundedOffset
	}
	Store.SaveChanges()

	LyricsOffsetChangedSignal.Fire(roundedOffset)
}

export const AdjustLyricsOffset = (delta: number) => SetLyricsOffset(GetLyricsOffset() + delta)

export const GetLyricsOffsetString = (offset: number = GetLyricsOffset()): string => (
	(offset === 0) ? "0.0s"
	: `${(offset > 0) ? "+" : "-"}${Math.abs(offset).toFixed(1)}s`
)
