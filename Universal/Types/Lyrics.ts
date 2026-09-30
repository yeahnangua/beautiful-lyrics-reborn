export type LyricsSource = {
  Provider: string;
  Transport: "direct" | "lyrically";
  TrackId?: string;
  LyricsId?: string;
  MatchedTitle?: string;
};
export type LyricsProvenance = {
  Source?: LyricsSource;
  RequestId?: string;
  RetrievedAt?: string;
  LyricsHash?: string;
};
// Finalized Lyric Structure
type TimeMetadata = {
	StartTime: number;
	EndTime: number;
}
export type TextMetadata = {
	Text: string;
}
type VocalMetadata = (
	TimeMetadata
	& TextMetadata
)

export type Interlude = (
	TimeMetadata
	& {
		Type: "Interlude";
	}
)

export type StaticSyncedLyrics = LyricsProvenance & {
	Type: "Static";
	Lines: TextMetadata[];
}

export type LineVocal = (
	VocalMetadata
	& {
		Type: "Vocal";

		OppositeAligned: boolean;
	}
)
export type LineSyncedLyrics = LyricsProvenance & (
	TimeMetadata
	& {
		Type: "Line";
		Content: (LineVocal | Interlude)[];
	}
)

export type SyllableMetadata = (
	VocalMetadata
	& {
		IsPartOfWord: boolean;
	}
)
export type SyllableList = SyllableMetadata[]
export type SyllableVocal = (
	TimeMetadata
	& {
		Syllables: SyllableList;
	}
)
export type SyllableVocalSet = {
	Type: "Vocal";

	OppositeAligned: boolean;

	Lead: SyllableVocal;
	Background?: SyllableVocal[];
}
export type SyllableSyncedLyrics = LyricsProvenance & (
	TimeMetadata
	& {
		Type: "Syllable";
		Content: (SyllableVocalSet | Interlude)[];
	}
)

export type Lyrics = (StaticSyncedLyrics | LineSyncedLyrics | SyllableSyncedLyrics)