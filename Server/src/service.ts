import type { BeautifulLyrics, ProviderClients, SpotifyClientContext, TrackMetadata } from "./types";

export type LyricsService = {
  getLyrics(
    trackId: string,
    accessToken: string,
    suppliedTrackMetadata?: TrackMetadata,
    clientContext?: SpotifyClientContext
  ): Promise<BeautifulLyrics | undefined>;
};

export function createLyricsService(providers: ProviderClients): LyricsService {
  return {
    async getLyrics(
      trackId: string,
      accessToken: string,
      suppliedTrackMetadata?: TrackMetadata,
      clientContext?: SpotifyClientContext
    ): Promise<BeautifulLyrics | undefined> {
      console.log(`[lyrics] ${trackId}: request started`);

      const suppliedAmllDbSyllableLyrics = await providers.amlldb
        .getSyllableLyrics(trackId, suppliedTrackMetadata)
        .catch((error) => {
          console.warn(`[lyrics] ${trackId}: amlldb failed`, error);
          return undefined;
        });
      if (suppliedAmllDbSyllableLyrics !== undefined) {
        console.log(`[lyrics] ${trackId}: using amlldb ${suppliedAmllDbSyllableLyrics.Type}`);
        return suppliedAmllDbSyllableLyrics;
      }
      console.log(`[lyrics] ${trackId}: amlldb initial lookup unavailable`);

      const trackMetadata =
        suppliedTrackMetadata ??
        (await providers.spotify.getTrackMetadata(trackId, accessToken, clientContext).catch((error) => {
          console.warn(`[lyrics] ${trackId}: spotify metadata failed`, error);
          return undefined;
        }));
      if (trackMetadata !== undefined) {
        console.log(
          `[lyrics] ${trackId}: metadata "${trackMetadata.name}" by ${trackMetadata.artists.join(", ") || "unknown"}`
        );
      }

      const searchedAmllDbSyllableLyrics =
        suppliedTrackMetadata === undefined && trackMetadata !== undefined
          ? await providers.amlldb.getSyllableLyrics(trackId, trackMetadata).catch((error) => {
              console.warn(`[lyrics] ${trackId}: amlldb failed`, error);
              return undefined;
            })
          : undefined;
      if (searchedAmllDbSyllableLyrics !== undefined) {
        console.log(`[lyrics] ${trackId}: using amlldb ${searchedAmllDbSyllableLyrics.Type}`);
        return searchedAmllDbSyllableLyrics;
      }
      console.log(`[lyrics] ${trackId}: amlldb syllable lyrics unavailable`);

      if (trackMetadata !== undefined) {
        const qqMusicSyllableLyrics = await providers.qqmusic.getSyllableLyrics(trackMetadata).catch((error) => {
          console.warn(`[lyrics] ${trackId}: qq music failed`, error);
          return undefined;
        });
        if (qqMusicSyllableLyrics !== undefined) {
          console.log(`[lyrics] ${trackId}: using qq music ${qqMusicSyllableLyrics.Type}`);
          return qqMusicSyllableLyrics;
        }
        console.log(`[lyrics] ${trackId}: qq music syllable lyrics unavailable`);
      }

      const lyricallyTrackMetadata = trackMetadata ?? { id: trackId, name: "", artists: [] };
      const lyricallySyllableLyrics = await providers.lyrically
        .getSyllableLyrics(lyricallyTrackMetadata)
        .catch((error) => {
          console.warn(`[lyrics] ${trackId}: lyrically failed`, error);
          return undefined;
        });
      if (lyricallySyllableLyrics !== undefined) {
        console.log(`[lyrics] ${trackId}: using lyrically ${lyricallySyllableLyrics.Type}`);
        return lyricallySyllableLyrics;
      }
      console.log(`[lyrics] ${trackId}: lyrically syllable lyrics unavailable`);

      const deezerLyrics =
        trackMetadata === undefined
          ? undefined
          : await providers.lyrically.getDeezerLyrics(trackMetadata).catch((error) => {
              console.warn(`[lyrics] ${trackId}: lyrically deezer failed`, error);
              return undefined;
            });
      if (deezerLyrics?.Type === "Syllable") {
        console.log(`[lyrics] ${trackId}: using lyrically deezer ${deezerLyrics.Type}`);
        return deezerLyrics;
      }

      const lyricallyLyrics = await providers.lyrically.getLyrics(lyricallyTrackMetadata).catch((error) => {
        console.warn(`[lyrics] ${trackId}: lyrically spotify proxy failed`, error);
        return undefined;
      });
      if (lyricallyLyrics?.Type === "Line" || lyricallyLyrics?.Type === "Syllable") {
        console.log(`[lyrics] ${trackId}: using lyrically spotify proxy ${lyricallyLyrics.Type}`);
        return lyricallyLyrics;
      }
      if (lyricallyLyrics === undefined) {
        console.log(`[lyrics] ${trackId}: lyrically spotify proxy lyrics unavailable`);
      } else {
        console.log(`[lyrics] ${trackId}: holding lyrically spotify proxy ${lyricallyLyrics.Type} as final fallback`);
      }

      const spotifyLyrics = await providers.spotify.getLyrics(trackId, accessToken, clientContext).catch((error) => {
        console.warn(`[lyrics] ${trackId}: spotify lyrics failed`, error);
        return undefined;
      });
      if (spotifyLyrics?.Type === "Line") {
        console.log(`[lyrics] ${trackId}: using spotify ${spotifyLyrics.Type}`);
        return spotifyLyrics;
      }
      if (spotifyLyrics === undefined) {
        console.log(`[lyrics] ${trackId}: spotify lyrics unavailable`);
      } else {
        console.log(`[lyrics] ${trackId}: holding spotify ${spotifyLyrics.Type} as final fallback`);
      }

      if (deezerLyrics?.Type === "Line") {
        console.log(`[lyrics] ${trackId}: using lyrically deezer ${deezerLyrics.Type}`);
        return deezerLyrics;
      }

      const youtubeLyrics =
        trackMetadata === undefined
          ? undefined
          : await providers.lyrically.getYouTubeLyrics(trackMetadata).catch((error) => {
              console.warn(`[lyrics] ${trackId}: lyrically youtube failed`, error);
              return undefined;
            });
      if (youtubeLyrics !== undefined && youtubeLyrics.Type !== "Static") {
        console.log(`[lyrics] ${trackId}: using lyrically youtube ${youtubeLyrics.Type}`);
        return youtubeLyrics;
      }

      if (trackMetadata === undefined) {
        console.log(`[lyrics] ${trackId}: no metadata, cannot use fallback`);
        if (lyricallyLyrics !== undefined) {
          console.log(`[lyrics] ${trackId}: using lyrically spotify proxy ${lyricallyLyrics.Type}`);
          return lyricallyLyrics;
        } else if (spotifyLyrics !== undefined) {
          console.log(`[lyrics] ${trackId}: using spotify ${spotifyLyrics.Type}`);
          return spotifyLyrics;
        }
        return undefined;
      }
      console.log(
        `[lyrics] ${trackId}: metadata "${trackMetadata.name}" by ${trackMetadata.artists.join(", ") || "unknown"}`
      );

      const fallbackLyrics = await providers.lrclib.getLyrics(trackMetadata).catch((error) => {
        console.warn(`[lyrics] ${trackId}: lrclib failed`, error);
        return undefined;
      });
      if (fallbackLyrics !== undefined && fallbackLyrics.Type !== "Static") {
        console.log(`[lyrics] ${trackId}: using lrclib ${fallbackLyrics.Type}`);
        return fallbackLyrics;
      }

      const geniusLyrics = await providers.lyrically.getGeniusLyrics(trackMetadata).catch((error) => {
        console.warn(`[lyrics] ${trackId}: lyrically genius failed`, error);
        return undefined;
      });

      if (lyricallyLyrics !== undefined) {
        console.log(`[lyrics] ${trackId}: using lyrically spotify proxy ${lyricallyLyrics.Type}`);
        return lyricallyLyrics;
      } else if (spotifyLyrics !== undefined) {
        console.log(`[lyrics] ${trackId}: using spotify ${spotifyLyrics.Type}`);
        return spotifyLyrics;
      } else if (deezerLyrics !== undefined) {
        console.log(`[lyrics] ${trackId}: using lyrically deezer ${deezerLyrics.Type}`);
        return deezerLyrics;
      } else if (youtubeLyrics !== undefined) {
        console.log(`[lyrics] ${trackId}: using lyrically youtube ${youtubeLyrics.Type}`);
        return youtubeLyrics;
      } else if (geniusLyrics !== undefined) {
        console.log(`[lyrics] ${trackId}: using lyrically genius ${geniusLyrics.Type}`);
        return geniusLyrics;
      } else if (fallbackLyrics !== undefined) {
        console.log(`[lyrics] ${trackId}: using lrclib ${fallbackLyrics.Type}`);
        return fallbackLyrics;
      } else {
        console.log(`[lyrics] ${trackId}: no lyrics found`);
      }

      return undefined;
    }
  };
}
