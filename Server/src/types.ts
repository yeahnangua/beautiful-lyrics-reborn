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
export type TextMetadata = {
  Text: string;
};

export type TimeMetadata = {
  StartTime: number;
  EndTime: number;
};

export type StaticSyncedLyrics = LyricsProvenance & {
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

export type LineSyncedLyrics = LyricsProvenance & TimeMetadata & {
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

export type SyllableSyncedLyrics = LyricsProvenance & TimeMetadata & {
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
  appleMusicId?: string;
  appleMusicTitle?: string;
};

export type SpotifyClientContext = {
  appPlatform?: string;
  appVersion?: string;
};

export type RequestContext = {
  sourceBlocks?: readonly SourceBlock[];
  signal?: AbortSignal;
  deadline?: number;
  trace?: ProviderAttempt;
  diagnostics?: RequestDiagnostics;
};

export type ProviderClients = {
  // amlldb: AmllDbProvider;
  qqmusic: QqMusicProvider;
  kugou: SyllableLyricsProvider;
  netease: SyllableLyricsProvider;
  musixmatch: SyllableLyricsProvider;
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
    clientContext?: SpotifyClientContext,
    context?: RequestContext
  ): Promise<BeautifulLyrics | undefined>;
  getTrackMetadata(
    trackId: string,
    accessToken: string,
    clientContext?: SpotifyClientContext,
    context?: RequestContext
  ): Promise<TrackMetadata | undefined>;
};

export type LrclibProvider = {
  getLyrics(track: TrackMetadata, context?: RequestContext): Promise<BeautifulLyrics | undefined>;
};

export type QqMusicProvider = {
  getSyllableLyrics(track: TrackMetadata, context?: RequestContext): Promise<SyllableSyncedLyrics | undefined>;
};

export type SyllableLyricsProvider = QqMusicProvider;

export type LyricallyProvider = {
  // getSyllableLyrics(track: TrackMetadata, context?: RequestContext): Promise<SyllableSyncedLyrics | undefined>;
  getAppleMusicLyrics(track: TrackMetadata, context?: RequestContext): Promise<BeautifulLyrics | undefined>;
  getKugouLyrics(track: TrackMetadata, word: boolean, context?: RequestContext): Promise<BeautifulLyrics | undefined>;
  getNeteaseLyrics(track: TrackMetadata, word: boolean, context?: RequestContext): Promise<BeautifulLyrics | undefined>;
  getLyrics(track: TrackMetadata, context?: RequestContext): Promise<BeautifulLyrics | undefined>;
  getYouTubeLyrics(track: TrackMetadata, context?: RequestContext): Promise<BeautifulLyrics | undefined>;
  getDeezerLyrics(track: TrackMetadata, context?: RequestContext): Promise<BeautifulLyrics | undefined>;
  getGeniusLyrics(track: TrackMetadata, context?: RequestContext): Promise<StaticSyncedLyrics | undefined>;
};

export type UpstreamEvent = {
  endpoint: string;
  durationMs: number;
  status?: number;
  outcome: "pending" | "success" | "failed" | "timeout" | "cancelled";
};
export type ProviderAttempt = {
  provider: string;
  stage: "metadata" | "syllable" | "line" | "static";
  startedAt: string;
  durationMs: number;
  outcome: "pending" | "success" | "none" | "failed" | "timeout" | "cancelled" | "blocked";
  blockAction?: "skipped" | "filtered";
  lyricsType?: BeautifulLyrics["Type"];
  source?: LyricsSource;
  error?: string;
  matches?: LyricsSource[];
  retries: number;
  upstream: UpstreamEvent[];
};
export type RequestDiagnostics = {
  id: string;
  track: TrackMetadata;
  startedAt: string;
  durationMs: number;
  outcome: "pending" | "success" | "none" | "failed" | "cancelled";
  source?: LyricsSource;
  lyricsHash?: string;
  attempts: ProviderAttempt[];
  sourceBlocks?: readonly SourceBlock[];
  sourcePolicyStatus?: "applied" | "unavailable" | "unconfigured";
};

export type SourceBlock = { provider: string; lyricsType: BeautifulLyrics["Type"] };
