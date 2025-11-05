// Finalized Lyric Structure
type TimeMetadata = {
	StartTime: number;
	EndTime: number;
}
export type TextMetadata = {
	Text: string;
	RomanizedText?: string; // Populated on the Client
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

export type StaticSyncedLyrics = {
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
export type LineSyncedLyrics = (
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
export type SyllableSyncedLyrics = (
	TimeMetadata
	& {
		Type: "Syllable";
		Content: (SyllableVocalSet | Interlude)[];
	}
)

export type Lyrics = (StaticSyncedLyrics | LineSyncedLyrics | SyllableSyncedLyrics)