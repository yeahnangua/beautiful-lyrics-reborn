import { decodeEntitiesDeep } from "./convert/entities";
import { matchedTitle } from "./providers/matched-title";
import { abortable, requestScope } from "./providers/request";
import type { BeautifulLyrics, ProviderClients, RequestContext, SpotifyClientContext, TrackMetadata } from "./types";

function isLiveTitle(title: string): boolean {
  return /\b(?:live|concert)\b|演唱[会會]|现[场場]|實況|实况/i.test(title);
}

type Candidate = readonly [string, BeautifulLyrics];
export type LyricsService = {
  getLyrics(trackId: string, accessToken: string, suppliedTrackMetadata?: TrackMetadata,
    clientContext?: SpotifyClientContext, context?: RequestContext): Promise<BeautifulLyrics | undefined>;
};

export function createLyricsService(providers: ProviderClients): LyricsService {
  return {
    async getLyrics(trackId, accessToken, suppliedTrackMetadata, clientContext, context = {}) {
      const available = new Map<string, BeautifulLyrics>();
      let metadata = suppliedTrackMetadata;
      const finish = (result: Candidate | undefined) => {
        if (!result || context.signal?.aborted) return undefined;
        console.log(`[lyrics] ${trackId}: using ${result[0]} ${result[1].Type}`);
        return decodeEntitiesDeep(result[1]);
      };
      const run = async (name: string, request: () => Promise<BeautifulLyrics | undefined>,
        scope: RequestContext): Promise<Candidate> => {
        const lyrics = await abortable(request, scope.signal!).catch(error => {
          if (!scope.signal?.aborted) console.warn(`[lyrics] ${trackId}: ${name} failed`, error);
          return undefined;
        });
        if (!lyrics || scope.signal?.aborted) throw new Error("No usable lyrics");
        available.set(name, lyrics);
        return [name, lyrics];
      };
      const first = (candidates: Promise<Candidate>[], accept: (lyrics: BeautifulLyrics) => boolean) =>
        Promise.any(candidates.map(async candidate => {
          const result = await candidate;
          if (!accept(result[1])) throw new Error("Lower quality lyrics");
          return result;
        })).catch(() => undefined);

      // Metadata and every syllable source share the same 15-second budget.
      const syllable = requestScope(15_000, context);
      try {
        const metadataPromise = abortable(async () => metadata ??
          providers.spotify.getTrackMetadata(trackId, accessToken, clientContext, syllable), syllable.signal)
          .catch(() => undefined).then(value => {
            if (!syllable.signal.aborted) metadata = value;
            return value;
          });
        const withMetadata = (request: (track: TrackMetadata) => Promise<BeautifulLyrics | undefined>) =>
          async () => {
            const track = await metadataPromise;
            syllable.signal.throwIfAborted();
            return track ? request(track) : undefined;
          };
        const candidates = [
          run("qq music", withMetadata(t => providers.qqmusic.getSyllableLyrics(t, syllable)), syllable),
          run("kugou direct", withMetadata(t => providers.kugou.getSyllableLyrics(t, syllable)), syllable),
          run("netease direct", withMetadata(t => providers.netease.getSyllableLyrics(t, syllable)), syllable),
          run("musixmatch direct", withMetadata(t => providers.musixmatch.getSyllableLyrics(t, syllable)), syllable),
          run("apple music", withMetadata(t => providers.lyrically.getAppleMusicLyrics(t, syllable)), syllable),
          run("kugou", withMetadata(t => providers.lyrically.getKugouLyrics(t, true, syllable)), syllable),
          run("netease", withMetadata(t => providers.lyrically.getNeteaseLyrics(t, true, syllable)), syllable),
          run("deezer", withMetadata(t => providers.lyrically.getDeezerLyrics(t, syllable)), syllable)
        ];
        let winner = await first(candidates, lyrics => lyrics.Type === "Syllable");
        if (winner && isLiveTitle(matchedTitle(winner[1]) ?? metadata?.name ?? "")) {
          const alternativeScope = requestScope(2_000, syllable);
          try {
            const alternative = await abortable(() => Promise.any(candidates.map(async candidate => {
              const result = await candidate;
              if (result[1].Type !== "Syllable" || isLiveTitle(matchedTitle(result[1]) ?? metadata?.name ?? "")) {
                throw new Error("Not a studio syllable result");
              }
              return result;
            })).catch(() => undefined), alternativeScope.signal).catch(() => undefined);
            winner = alternative ?? winner;
          } finally { alternativeScope.dispose(); }
        }
        if (winner) return finish(winner);
      } finally { syllable.cancel(); syllable.dispose(); }
      if (context.signal?.aborted) return undefined;

      // Static responses are saved, never allowed to win against a pending line search.
      const line = requestScope(10_000, context);
      try {
        const track = metadata ?? { id: trackId, name: "", artists: [] };
        const candidates: Promise<Candidate>[] = [...available].filter(([, lyrics]) => lyrics.Type !== "Static")
          .map(result => Promise.resolve(result));
        candidates.push(
          run("spotify proxy", () => providers.lyrically.getLyrics(track, line), line),
          run("spotify", () => providers.spotify.getLyrics(trackId, accessToken, clientContext, line), line)
        );
        if (metadata) {
          const knownTrack = metadata;
          candidates.push(
            run("kugou", () => providers.lyrically.getKugouLyrics(knownTrack, false, line), line),
            run("netease", () => providers.lyrically.getNeteaseLyrics(knownTrack, false, line), line),
            run("youtube", () => providers.lyrically.getYouTubeLyrics(knownTrack, line), line),
            run("lrclib", () => providers.lrclib.getLyrics(knownTrack, line), line)
          );
        }
        const winner = await first(candidates, lyrics => lyrics.Type !== "Static");
        if (winner) return finish(winner);
      } finally { line.cancel(); line.dispose(); }
      if (context.signal?.aborted) return undefined;

      const staticOrder = ["spotify proxy", "spotify", "deezer", "youtube", "genius", "lrclib", "apple music", "kugou", "netease"];
      for (const source of staticOrder) {
        const lyrics = available.get(source);
        if (lyrics?.Type === "Static") return finish([source, lyrics]);
      }
      if (!metadata) return undefined;
      const fallback = requestScope(5_000, context);
      try {
        return finish(await run("genius", () => providers.lyrically.getGeniusLyrics(metadata!, fallback), fallback)
          .catch(() => undefined));
      } finally { fallback.cancel(); fallback.dispose(); }
    }
  };
}
