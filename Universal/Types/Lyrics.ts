export type Contributor = { id: string; username: string; url: string };
export type SpicyAttribution = {
  provider: "spicylyrics";
  source: string;
  uploader?: Contributor;
  maker?: Contributor;
};
export type LyricsSource = {
  Provider: string;
  Transport: "direct" | "lyrically";
  TrackId?: string;
  LyricsId?: string;
  MatchedTitle?: string;
};
export type LyricsProvenance = {
  Attribution?: SpicyAttribution;
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
  IsAttribution?: true;
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
		// True when this syllable joins the next one without an intervening space.
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
  IsAttribution?: true;
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
