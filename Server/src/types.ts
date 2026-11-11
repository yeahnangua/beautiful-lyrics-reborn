import type { LyricsAttribution } from "../../Universal/Types/Lyrics";
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
  IsAttribution?: true;
};

export type TimeMetadata = {
  StartTime: number;
  EndTime: number;
};

export type StaticSyncedLyrics = LyricsProvenance & {
  Type: "Static";
  Lines: TextMetadata[];
  /** Provider credits carried through cache and rendering. */
  Attribution?: LyricsAttribution;
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
  /** Provider credits carried through cache and rendering. */
  Attribution?: LyricsAttribution;
};

export type SyllableMetadata = TimeMetadata &
  TextMetadata & {
    // True when this syllable joins the next one without an intervening space.
    IsPartOfWord: boolean;
  };

export type SyllableVocal = TimeMetadata & {
  Syllables: SyllableMetadata[];
};

export type SyllableVocalSet = {
  IsAttribution?: true;
  Type: "Vocal";
  OppositeAligned: boolean;
  Lead: SyllableVocal;
  Background?: SyllableVocal[];
};

export type SyllableSyncedLyrics = LyricsProvenance & TimeMetadata & {
  Type: "Syllable";
  Content: (SyllableVocalSet | Interlude)[];
  /** Provider credits carried through cache and rendering. */
  Attribution?: LyricsAttribution;
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
  kugou: TimedLyricsProvider;
  netease: TimedLyricsProvider;
  spicylyrics: SpicyLyricsProvider;
  applemusic: AppleMusicProvider;
  lrcred: LrcRedProvider;
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

export type LrcRedProvider = {
  getLyrics(track: TrackMetadata, context?: RequestContext): Promise<BeautifulLyrics | undefined>;
};

export type SpicyLyricsProvider = {
  getLyrics(track: TrackMetadata, context?: RequestContext): Promise<BeautifulLyrics | undefined>;
};

export type AppleMusicProvider = {
  getLyrics(track: TrackMetadata, context?: RequestContext): Promise<LineSyncedLyrics | SyllableSyncedLyrics | undefined>;
};

export type TimedLyricsProvider = {
  getSyllableLyrics(track: TrackMetadata, context?: RequestContext): Promise<SyllableSyncedLyrics | undefined>;
  getLineLyrics(track: TrackMetadata, context?: RequestContext): Promise<LineSyncedLyrics | undefined>;
};

export type QqMusicProvider = TimedLyricsProvider;

export type UpstreamDetails = {
  operation?: "search" | "lyrics" | "metadata";
  query?: string;
  result?: "matched" | "found" | "no_results" | "missing_song_list" | "no_match" | "no_lyrics" | "no_syllable_lyrics" | "no_line_lyrics"
    | "instrumental" | "restricted" | "missing_attribution" | "http_error" | "api_error" | "invalid_payload";
  codes?: Record<string, number | undefined>;
  resultCount?: number;
  matchedCount?: number;
};
export type UpstreamEvent = UpstreamDetails & {
  endpoint: string;
  durationMs: number;
  status?: number;
  outcome: "pending" | "success" | "failed" | "timeout" | "cancelled";
};
export type ProviderAttempt = {
  selected?: boolean;
  provider: string;
  stage: "metadata" | "syllable" | "line" | "static";
  startedAt: string;
  durationMs: number;
  outcome: "pending" | "success" | "none" | "failed" | "timeout" | "cancelled" | "blocked";
  blockAction?: "skipped" | "filtered";
  lyricsType?: BeautifulLyrics["Type"];
  source?: LyricsSource;
  error?: string;
  reason?: "not_configured" | "metadata_unavailable" | "token_unavailable" | "apple_music_id_unavailable" | "upstream_backoff";
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
  /** Whether this request was answered from the stored lyrics cache. */
  cache?: "hit" | "miss";
  source?: LyricsSource;
  lyricsHash?: string;
  attempts: ProviderAttempt[];
  sourceBlocks?: readonly SourceBlock[];
  sourcePolicyStatus?: "applied" | "unavailable" | "unconfigured";
};

export type SourceBlock = { provider: string; lyricsType: BeautifulLyrics["Type"] };

export type { Contributor, SpicyAttribution } from "../../Universal/Types/Lyrics";
