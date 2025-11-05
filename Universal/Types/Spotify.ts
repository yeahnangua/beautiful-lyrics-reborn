export type SpotifyTrackInformation = {
  album: {
    album_type: string;
    total_tracks: number;
    available_markets: string[];
    external_urls: {
      spotify: string;
    };
    href: string;
    id: string;
    images: {
      url: string;
      height: number;
      width: number;
    }[];
    name: string;
    release_date: string;
    release_date_precision: string;
    restrictions: {
      reason: string;
    };
    type: string;
    uri: string;
    artists: {
      external_urls: {
        spotify: string;
      };
      href: string;
      id: string;
      name: string;
      type: string;
      uri: string;
    }[];
  };
  artists: {
    external_urls: {
      spotify: string;
    };
    followers: {
      href: string;
      total: number;
    };
    genres: string[];
    href: string;
    id: string;
    images: {
      url: string;
      height: number;
      width: number;
    }[];
    name: string;
    popularity: number;
    type: string;
    uri: string;
  }[];
  available_markets: string[];
  disc_number: number;
  duration_ms: number;
  explicit: boolean;
  external_ids: {
    isrc: string;
    ean: string;
    upc: string;
  };
  external_urls: {
    spotify: string;
  };
  href: string;
  id: string;
  is_playable: boolean;
  linked_from: {};
  restrictions: {
    reason: string;
  };
  name: string;
  popularity: number;
  preview_url: string;
  track_number: number;
  type: string;
  uri: string;
  is_local: boolean;
}

// Future (maybe)
namespace RetrievedLyricsSpace {
  type Line = {
    startTimeMs: string;
    words: string;
    syllables: any[]; // Similarly, I am not sure what the elements of this array look like
    endTimeMs: string;
  };

  type SongColors = {
    background: number;
    text: number;
    highlightText: number;
  };

  type SyncType = "SYLLABLE_SYNCED" | "LINE_SYNCED" | "UNSYNCED";

  type SongLyrics = {
    syncType: SyncType;
    lines: Line[];
    provider: string;
    providerLyricsId: string;
    providerDisplayName: string;
    syncLyricsUri: string;
    isDenseTypeface: boolean;
    alternatives: any[]; // I am not sure what the elements of this array look like, so for now I'll just put any
    language: string;
    isRtlLanguage: boolean;
    fullscreenAction: string;
  };

  type LyricsData = {
    lyrics: SongLyrics;
    colors: SongColors;
    hasVocalRemoval: boolean;
  };

  export type LyricSyncType = SyncType;
  export type LyricLines = Line[];
  export type Self = LyricsData;
}
