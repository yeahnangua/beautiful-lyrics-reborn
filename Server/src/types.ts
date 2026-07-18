export type TextMetadata = {
  Text: string;
  RomanizedText?: string;
};

export type TimeMetadata = {
  StartTime: number;
  EndTime: number;
};

export type StaticSyncedLyrics = {
  Type: "Static";
  Lines: TextMetadata[];
};

export type LineVocal = TimeMetadata &
  TextMetadata & {
    Type: "Vocal";
    OppositeAligned: boolean;
  };

export type Interlude = TimeMetadata & {
  Type: "Interlude";
};

export type LineSyncedLyrics = TimeMetadata & {
  Type: "Line";
  Content: (LineVocal | Interlude)[];
};

export type SyllableMetadata = TimeMetadata &
  TextMetadata & {
    IsPartOfWord: boolean;
  };

export type SyllableVocal = TimeMetadata & {
  Syllables: SyllableMetadata[];
};

export type SyllableVocalSet = {
  Type: "Vocal";
  OppositeAligned: boolean;
  Lead: SyllableVocal;
  Background?: SyllableVocal[];
};

export type SyllableSyncedLyrics = TimeMetadata & {
  Type: "Syllable";
  Content: (SyllableVocalSet | Interlude)[];
};

export type BeautifulLyrics = StaticSyncedLyrics | LineSyncedLyrics | SyllableSyncedLyrics;

export type TrackMetadata = {
  id: string;
  name: string;
  artists: string[];
  album?: string;
  durationSeconds?: number;
  isrc?: string;
};

export type SpotifyClientContext = {
  appPlatform?: string;
  appVersion?: string;
};

export type ProviderClients = {
  // amlldb: AmllDbProvider;
  qqmusic: QqMusicProvider;
  lyrically: LyricallyProvider;
  spotify: SpotifyProvider;
  lrclib: LrclibProvider;
};

export type AmllDbProvider = {
  getSyllableLyrics(trackId: string, track?: TrackMetadata): Promise<SyllableSyncedLyrics | undefined>;
};

export type SpotifyProvider = {
  getLyrics(
    trackId: string,
    accessToken: string,
    clientContext?: SpotifyClientContext
  ): Promise<BeautifulLyrics | undefined>;
  getTrackMetadata(
    trackId: string,
    accessToken: string,
    clientContext?: SpotifyClientContext
  ): Promise<TrackMetadata | undefined>;
};

export type LrclibProvider = {
  getLyrics(track: TrackMetadata): Promise<BeautifulLyrics | undefined>;
};

export type QqMusicProvider = {
  getSyllableLyrics(track: TrackMetadata): Promise<SyllableSyncedLyrics | undefined>;
};

export type LyricallyProvider = {
  // getSyllableLyrics(track: TrackMetadata): Promise<SyllableSyncedLyrics | undefined>;
  getKugouLyrics(track: TrackMetadata, word: boolean): Promise<BeautifulLyrics | undefined>;
  getNeteaseLyrics(track: TrackMetadata, word: boolean): Promise<BeautifulLyrics | undefined>;
  getLyrics(track: TrackMetadata): Promise<BeautifulLyrics | undefined>;
  getYouTubeLyrics(track: TrackMetadata): Promise<BeautifulLyrics | undefined>;
  getDeezerLyrics(track: TrackMetadata): Promise<BeautifulLyrics | undefined>;
  getGeniusLyrics(track: TrackMetadata): Promise<StaticSyncedLyrics | undefined>;
};
