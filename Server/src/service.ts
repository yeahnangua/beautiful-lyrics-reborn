import type { BeautifulLyrics, ProviderClients, SpotifyClientContext, TrackMetadata } from "./types";

const syllableSearchTimeoutMs = 10_000;

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

      const syllableDeadline = Date.now() + syllableSearchTimeoutMs;
      let trackMetadata = suppliedTrackMetadata;
      let deezerLyrics: BeautifulLyrics | undefined;
      const suppliedAmllDbLyricsPromise = providers.amlldb
        .getSyllableLyrics(trackId, suppliedTrackMetadata)
        .catch((error) => {
          console.warn(`[lyrics] ${trackId}: amlldb failed`, error);
          return undefined;
        });
      const trackMetadataPromise = (
        suppliedTrackMetadata === undefined
          ? providers.spotify.getTrackMetadata(trackId, accessToken, clientContext).catch((error) => {
              console.warn(`[lyrics] ${trackId}: spotify metadata failed`, error);
              return undefined;
            })
          : Promise.resolve(suppliedTrackMetadata)
      ).then((metadata) => {
        trackMetadata = metadata;
        if (metadata !== undefined) {
          console.log(
            `[lyrics] ${trackId}: metadata "${metadata.name}" by ${metadata.artists.join(", ") || "unknown"}`
          );
        }
        return metadata;
      });
      const searchedAmllDbLyricsPromise = trackMetadataPromise.then((metadata) =>
        suppliedTrackMetadata === undefined && metadata !== undefined && Date.now() < syllableDeadline
          ? providers.amlldb.getSyllableLyrics(trackId, metadata).catch((error) => {
              console.warn(`[lyrics] ${trackId}: amlldb failed`, error);
              return undefined;
            })
          : undefined
      );
      const qqMusicLyricsPromise = trackMetadataPromise.then((metadata) =>
        metadata !== undefined && Date.now() < syllableDeadline
          ? providers.qqmusic.getSyllableLyrics(metadata).catch((error) => {
              console.warn(`[lyrics] ${trackId}: qq music failed`, error);
              return undefined;
            })
          : undefined
      );
      const lyricallySyllableLyricsPromise = trackMetadataPromise.then((metadata) =>
        Date.now() < syllableDeadline
          ? providers.lyrically
              .getSyllableLyrics(metadata ?? { id: trackId, name: "", artists: [] })
              .catch((error) => {
                console.warn(`[lyrics] ${trackId}: lyrically failed`, error);
                return undefined;
              })
          : undefined
      );
      const kugouSyllableLyricsPromise = trackMetadataPromise.then((metadata) =>
        metadata !== undefined && Date.now() < syllableDeadline
          ? providers.lyrically.getKugouLyrics(metadata, true).catch((error) => {
              console.warn(`[lyrics] ${trackId}: lyrically kugou failed`, error);
              return undefined;
            })
          : undefined
      );
      const deezerLyricsPromise = trackMetadataPromise.then(async (metadata) => {
        if (metadata === undefined || Date.now() >= syllableDeadline) {
          return undefined;
        }
        deezerLyrics = await providers.lyrically.getDeezerLyrics(metadata).catch((error) => {
          console.warn(`[lyrics] ${trackId}: lyrically deezer failed`, error);
          return undefined;
        });
        return deezerLyrics;
      });
      const syllableLyricsPromise = Promise.any([
        suppliedAmllDbLyricsPromise.then((lyrics) =>
          lyrics === undefined ? Promise.reject() : (["amlldb", lyrics] as const)
        ),
        searchedAmllDbLyricsPromise.then((lyrics) =>
          lyrics === undefined ? Promise.reject() : (["amlldb", lyrics] as const)
        ),
        qqMusicLyricsPromise.then((lyrics) =>
          lyrics === undefined ? Promise.reject() : (["qq music", lyrics] as const)
        ),
        lyricallySyllableLyricsPromise.then((lyrics) =>
          lyrics === undefined ? Promise.reject() : (["lyrically", lyrics] as const)
        ),
        kugouSyllableLyricsPromise.then((lyrics) =>
          lyrics?.Type === "Syllable" ? (["lyrically kugou", lyrics] as const) : Promise.reject()
        ),
        deezerLyricsPromise.then((lyrics) =>
          lyrics?.Type === "Syllable" ? (["lyrically deezer", lyrics] as const) : Promise.reject()
        )
      ]).catch(() => undefined);
      let syllableTimedOut = false;
      let syllableTimeout: ReturnType<typeof setTimeout> | undefined;
      const syllableLyrics = await Promise.race([
        syllableLyricsPromise,
        new Promise<undefined>((resolve) => {
          syllableTimeout = setTimeout(() => {
            syllableTimedOut = true;
            resolve(undefined);
          }, Math.max(0, syllableDeadline - Date.now()));
        })
      ]);
      if (syllableTimeout !== undefined) {
        clearTimeout(syllableTimeout);
      }
      if (syllableLyrics !== undefined) {
        const [source, lyrics] = syllableLyrics;
        console.log(`[lyrics] ${trackId}: using ${source} ${lyrics.Type}`);
        return lyrics;
      }
      if (syllableTimedOut) {
        console.warn(`[lyrics] ${trackId}: syllable lookup timed out after ${syllableSearchTimeoutMs / 1000} seconds`);
      }

      const lineTrackMetadata = trackMetadata;
      const lineDeezerLyrics = deezerLyrics;
      const lyricallyTrackMetadata = lineTrackMetadata ?? { id: trackId, name: "", artists: [] };
      const lyricallyLyricsPromise = providers.lyrically.getLyrics(lyricallyTrackMetadata).catch((error) => {
        console.warn(`[lyrics] ${trackId}: lyrically spotify proxy failed`, error);
        return undefined;
      });
      const kugouLyricsPromise =
        lineTrackMetadata === undefined
          ? Promise.resolve(undefined)
          : providers.lyrically.getKugouLyrics(lineTrackMetadata, false).catch((error) => {
              console.warn(`[lyrics] ${trackId}: lyrically kugou failed`, error);
              return undefined;
            });
      const spotifyLyricsPromise = providers.spotify.getLyrics(trackId, accessToken, clientContext).catch((error) => {
        console.warn(`[lyrics] ${trackId}: spotify lyrics failed`, error);
        return undefined;
      });
      const youtubeLyricsPromise =
        lineTrackMetadata === undefined
          ? Promise.resolve(undefined)
          : providers.lyrically.getYouTubeLyrics(lineTrackMetadata).catch((error) => {
              console.warn(`[lyrics] ${trackId}: lyrically youtube failed`, error);
              return undefined;
            });
      const fallbackLyricsPromise =
        lineTrackMetadata === undefined
          ? Promise.resolve(undefined)
          : providers.lrclib.getLyrics(lineTrackMetadata).catch((error) => {
              console.warn(`[lyrics] ${trackId}: lrclib failed`, error);
              return undefined;
            });
      const synchronizedLyrics = await Promise.any([
        lineDeezerLyrics?.Type === "Line"
          ? Promise.resolve(["lyrically deezer", lineDeezerLyrics] as const)
          : Promise.reject(),
        lyricallyLyricsPromise.then((lyrics) =>
          lyrics?.Type === "Line" || lyrics?.Type === "Syllable"
            ? (["lyrically spotify proxy", lyrics] as const)
            : Promise.reject()
        ),
        kugouLyricsPromise.then((lyrics) =>
          lyrics?.Type === "Line" ? (["lyrically kugou", lyrics] as const) : Promise.reject()
        ),
        spotifyLyricsPromise.then((lyrics) =>
          lyrics?.Type === "Line" ? (["spotify", lyrics] as const) : Promise.reject()
        ),
        youtubeLyricsPromise.then((lyrics) =>
          lyrics !== undefined && lyrics.Type !== "Static"
            ? (["lyrically youtube", lyrics] as const)
            : Promise.reject()
        ),
        fallbackLyricsPromise.then((lyrics) =>
          lyrics !== undefined && lyrics.Type !== "Static" ? (["lrclib", lyrics] as const) : Promise.reject()
        )
      ]).catch(() => undefined);
      if (synchronizedLyrics !== undefined) {
        const [source, lyrics] = synchronizedLyrics;
        console.log(`[lyrics] ${trackId}: using ${source} ${lyrics.Type}`);
        return lyrics;
      }

      const [lyricallyLyrics, spotifyLyrics, youtubeLyrics, fallbackLyrics] = await Promise.all([
        lyricallyLyricsPromise,
        spotifyLyricsPromise,
        youtubeLyricsPromise,
        fallbackLyricsPromise
      ]);

      if (lineTrackMetadata === undefined) {
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
        `[lyrics] ${trackId}: metadata "${lineTrackMetadata.name}" by ${lineTrackMetadata.artists.join(", ") || "unknown"}`
      );

      const geniusLyrics = await providers.lyrically.getGeniusLyrics(lineTrackMetadata).catch((error) => {
        console.warn(`[lyrics] ${trackId}: lyrically genius failed`, error);
        return undefined;
      });

      if (lyricallyLyrics !== undefined) {
        console.log(`[lyrics] ${trackId}: using lyrically spotify proxy ${lyricallyLyrics.Type}`);
        return lyricallyLyrics;
      } else if (spotifyLyrics !== undefined) {
        console.log(`[lyrics] ${trackId}: using spotify ${spotifyLyrics.Type}`);
        return spotifyLyrics;
      } else if (lineDeezerLyrics !== undefined) {
        console.log(`[lyrics] ${trackId}: using lyrically deezer ${lineDeezerLyrics.Type}`);
        return lineDeezerLyrics;
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
