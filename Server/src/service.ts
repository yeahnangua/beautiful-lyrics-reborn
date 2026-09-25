import { decodeEntitiesDeep } from "./convert/entities";
import { matchedTitle } from "./providers/matched-title";
import type { BeautifulLyrics, ProviderClients, SpotifyClientContext, TrackMetadata } from "./types";

const syllableSearchTimeoutMs = 20_000;
const liveAlternativeWaitMs = 2_000;

function isLiveTitle(title: string): boolean {
  return /\b(?:live|concert)\b|演唱[会會]|现[场場]|實況|实况/i.test(title);
}

export type LyricsService = {
  getLyrics(
    trackId: string,
    accessToken: string,
    suppliedTrackMetadata?: TrackMetadata,
    clientContext?: SpotifyClientContext
  ): Promise<BeautifulLyrics | undefined>;
};

export function createLyricsService(providers: ProviderClients): LyricsService {
  const service: LyricsService = {
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
      let appleMusicLyrics: BeautifulLyrics | undefined;
      // AMLLDB syllable lyrics are intentionally disabled.
      /*
      const suppliedAmllDbLyricsPromise = providers.amlldb
        .getSyllableLyrics(trackId, suppliedTrackMetadata)
        .catch((error) => {
          console.warn(`[lyrics] ${trackId}: amlldb failed`, error);
          return undefined;
        });
      */
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
      // AMLLDB search fallback is intentionally disabled.
      /*
      const searchedAmllDbLyricsPromise = trackMetadataPromise.then((metadata) =>
        suppliedTrackMetadata === undefined && metadata !== undefined && Date.now() < syllableDeadline
          ? providers.amlldb.getSyllableLyrics(trackId, metadata).catch((error) => {
              console.warn(`[lyrics] ${trackId}: amlldb failed`, error);
              return undefined;
            })
          : undefined
      );
      */
      const qqMusicLyricsPromise = trackMetadataPromise.then((metadata) =>
        metadata !== undefined && Date.now() < syllableDeadline
          ? providers.qqmusic.getSyllableLyrics(metadata).catch((error) => {
              console.warn(`[lyrics] ${trackId}: qq music failed`, error);
              return undefined;
            })
          : undefined
      );
      const kugouDirectLyricsPromise = trackMetadataPromise.then((metadata) =>
        metadata !== undefined && Date.now() < syllableDeadline
          ? providers.kugou.getSyllableLyrics(metadata).catch((error) => {
              console.warn(`[lyrics] ${trackId}: kugou direct failed`, error);
              return undefined;
            })
          : undefined
      );
      const neteaseDirectLyricsPromise = trackMetadataPromise.then((metadata) =>
        metadata !== undefined && Date.now() < syllableDeadline
          ? providers.netease.getSyllableLyrics(metadata).catch((error) => {
              console.warn(`[lyrics] ${trackId}: netease direct failed`, error);
              return undefined;
            })
          : undefined
      );
      const musixmatchLyricsPromise = trackMetadataPromise.then((metadata) =>
        metadata !== undefined && Date.now() < syllableDeadline
          ? providers.musixmatch.getSyllableLyrics(metadata).catch((error) => {
              console.warn(`[lyrics] ${trackId}: musixmatch direct failed`, error);
              return undefined;
            })
          : undefined
      );
      // Lyrically Musixmatch syllable lyrics are intentionally disabled.
      /*
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
      */
      const kugouSyllableLyricsPromise = trackMetadataPromise.then((metadata) =>
        metadata !== undefined && Date.now() < syllableDeadline
          ? providers.lyrically.getKugouLyrics(metadata, true).catch((error) => {
              console.warn(`[lyrics] ${trackId}: lyrically kugou failed`, error);
              return undefined;
            })
          : undefined
      );
      const neteaseSyllableLyricsPromise = trackMetadataPromise.then((metadata) =>
        metadata !== undefined && Date.now() < syllableDeadline
          ? providers.lyrically.getNeteaseLyrics(metadata, true).catch((error) => {
              console.warn(`[lyrics] ${trackId}: lyrically netease failed`, error);
              return undefined;
            })
          : undefined
      );
      const appleMusicLyricsPromise = trackMetadataPromise.then(async (metadata) => {
        if (metadata === undefined || Date.now() >= syllableDeadline) {
          return undefined;
        }
        appleMusicLyrics = await providers.lyrically.getAppleMusicLyrics(metadata).catch((error) => {
          console.warn(`[lyrics] ${trackId}: lyrically apple music failed`, error);
          return undefined;
        });
        return appleMusicLyrics;
      });
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
      const syllableCandidates = [
        /*
        suppliedAmllDbLyricsPromise.then((lyrics) =>
          lyrics === undefined ? Promise.reject() : (["amlldb", lyrics] as const)
        ),
        searchedAmllDbLyricsPromise.then((lyrics) =>
          lyrics === undefined ? Promise.reject() : (["amlldb", lyrics] as const)
        ),
        */
        qqMusicLyricsPromise.then((lyrics) =>
          lyrics === undefined ? Promise.reject() : (["qq music", lyrics] as const)
        ),
        kugouDirectLyricsPromise.then((lyrics) =>
          lyrics === undefined ? Promise.reject() : (["kugou direct", lyrics] as const)
        ),
        neteaseDirectLyricsPromise.then((lyrics) =>
          lyrics === undefined ? Promise.reject() : (["netease direct", lyrics] as const)
        ),
        musixmatchLyricsPromise.then((lyrics) =>
          lyrics === undefined ? Promise.reject() : (["musixmatch direct", lyrics] as const)
        ),
        appleMusicLyricsPromise.then((lyrics) =>
          lyrics?.Type === "Syllable" ? (["lyrically apple music", lyrics] as const) : Promise.reject()
        ),
        /*
        lyricallySyllableLyricsPromise.then((lyrics) =>
          lyrics === undefined ? Promise.reject() : (["lyrically", lyrics] as const)
        ),
        */
        kugouSyllableLyricsPromise.then((lyrics) =>
          lyrics?.Type === "Syllable" ? (["lyrically kugou", lyrics] as const) : Promise.reject()
        ),
        neteaseSyllableLyricsPromise.then((lyrics) =>
          lyrics?.Type === "Syllable" ? (["lyrically netease", lyrics] as const) : Promise.reject()
        ),
        deezerLyricsPromise.then((lyrics) =>
          lyrics?.Type === "Syllable" ? (["lyrically deezer", lyrics] as const) : Promise.reject()
        )
      ];
      const syllableLyricsPromise = Promise.any(syllableCandidates).catch(() => undefined);
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
        let [source, lyrics] = syllableLyrics;
        const firstTitle = matchedTitle(lyrics) ?? trackMetadata?.name ?? "";
        if (isLiveTitle(firstTitle)) {
          console.log(`[lyrics] ${trackId}: first syllable result is live ("${firstTitle}"); waiting up to 2 seconds`);
          let alternativeTimeout: ReturnType<typeof setTimeout> | undefined;
          const alternative = await Promise.race([
            Promise.any(syllableCandidates.map(async (candidate) => {
              const result = await candidate;
              const title = matchedTitle(result[1]) ?? trackMetadata?.name ?? "";
              if (isLiveTitle(title)) {
                throw new Error("live version");
              }
              return result;
            })).catch(() => undefined),
            new Promise<undefined>((resolve) => {
              alternativeTimeout = setTimeout(() => resolve(undefined), liveAlternativeWaitMs);
            })
          ]);
          if (alternativeTimeout !== undefined) {
            clearTimeout(alternativeTimeout);
          }
          if (alternative !== undefined) {
            [source, lyrics] = alternative;
          }
        }
        console.log(`[lyrics] ${trackId}: using ${source} ${lyrics.Type}`);
        return lyrics;
      }
      if (syllableTimedOut) {
        console.warn(`[lyrics] ${trackId}: syllable lookup timed out after ${syllableSearchTimeoutMs / 1000} seconds`);
      }

      const lineTrackMetadata = trackMetadata;
      const lineDeezerLyrics = deezerLyrics;
      const lineAppleMusicLyrics = appleMusicLyrics;
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
      const neteaseLyricsPromise =
        lineTrackMetadata === undefined
          ? Promise.resolve(undefined)
          : providers.lyrically.getNeteaseLyrics(lineTrackMetadata, false).catch((error) => {
              console.warn(`[lyrics] ${trackId}: lyrically netease failed`, error);
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
        lineAppleMusicLyrics?.Type === "Line"
          ? Promise.resolve(["lyrically apple music", lineAppleMusicLyrics] as const)
          : Promise.reject(),
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
        neteaseLyricsPromise.then((lyrics) =>
          lyrics?.Type === "Line" ? (["lyrically netease", lyrics] as const) : Promise.reject()
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

  // Single exit point: whichever provider won, its text leaves here entity-free.
  return {
    getLyrics: (...args) =>
      service.getLyrics(...args).then((lyrics) => (lyrics === undefined ? undefined : decodeEntitiesDeep(lyrics)))
  };
}
