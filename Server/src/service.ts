import { decodeEntitiesDeep } from "./convert/entities";
import { matchedTitle } from "./providers/matched-title";
import { abortable, requestScope } from "./providers/request";
import type { BeautifulLyrics, ProviderClients, RequestContext, SpotifyClientContext, TrackMetadata, ProviderAttempt, LyricsSource } from "./types";

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
      const musixmatchEligibleAt = Date.now() + 5_000;
      const available = new Map<string, BeautifulLyrics>();
      let metadata = suppliedTrackMetadata;
      let stage: ProviderAttempt["stage"] = "syllable";
      const finish = (result: Candidate | undefined) => {
        if (!result || context.signal?.aborted) return undefined;
        console.log(`[lyrics] ${trackId}: using ${result[0]} ${result[1].Type}`);
        const lyrics = decodeEntitiesDeep(result[1]);
        const providerNames: Record<string, string> = { "qq music": "qqmusic", "apple music": "applemusic", "spotify proxy": "spotify" };
        const source: LyricsSource = lyrics.Source ?? {
          Provider: providerNames[result[0]] ?? result[0].replace(" direct", ""),
          Transport: ["apple music", "kugou", "netease", "deezer", "spotify proxy", "youtube", "genius"].includes(result[0]) ? "lyrically" : "direct",
          ...(matchedTitle(result[1]) ? { MatchedTitle: matchedTitle(result[1])! } : {})
        };
        lyrics.Source = source;
        if (context.diagnostics) {
          context.diagnostics.source = source;
          context.diagnostics.track = metadata ?? context.diagnostics.track;
        }
        return lyrics;
      };
      const run = async (name: string, request: (scope: RequestContext) => Promise<BeautifulLyrics | undefined>,
        scope: RequestContext): Promise<Candidate> => {
        const started = Date.now();
        const attempt: ProviderAttempt = { provider: name, stage, startedAt: new Date(started).toISOString(),
          durationMs: 0, outcome: "pending", retries: 0, upstream: [] };
        context.diagnostics?.attempts.push(attempt);
        try {
          const lyrics = await abortable(() => request({ ...scope, trace: attempt }), scope.signal!);
          scope.signal?.throwIfAborted();
          attempt.outcome = lyrics ? "success" : attempt.upstream.some(event => event.outcome === "timeout") ? "timeout"
            : attempt.upstream.some(event => event.outcome === "failed") ? "failed" : "none";
          if (!lyrics) throw new Error("No usable lyrics");
          attempt.lyricsType = lyrics.Type;
          if (lyrics.Source) attempt.source = lyrics.Source;
          available.set(name, lyrics);
          return [name, lyrics];
        } catch (error) {
          if (scope.signal?.aborted) {
            attempt.outcome = scope.signal.reason?.name === "TimeoutError" ? "timeout" : "cancelled";
          } else if (attempt.outcome === "pending") {
            attempt.outcome = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "failed";
            // Arbitrary upstream error messages can contain credentials or URLs.
            attempt.error = error instanceof SyntaxError ? "Invalid upstream payload" : "Provider request failed";
          }
          throw new Error("No usable lyrics");
        } finally { attempt.durationMs = Date.now() - started; }
      };
      const first = (candidates: Promise<Candidate>[], accept: (lyrics: BeautifulLyrics) => boolean) =>
        Promise.any(candidates.map(async candidate => {
          const result = await candidate;
          if (!accept(result[1])) throw new Error("Lower quality lyrics");
          return result;
        })).catch(() => undefined);

      // Metadata and every syllable source share the same 15-second budget.
      const syllable = requestScope(15_000, context);
      const syllableCandidates: Promise<Candidate>[] = [];
      try {
        const metadataStarted = Date.now();
        const metadataAttempt: ProviderAttempt = { provider: "spotify", stage: "metadata", startedAt: new Date(metadataStarted).toISOString(), durationMs: 0, outcome: "pending", retries: 0, upstream: [] };
        if (!metadata) context.diagnostics?.attempts.push(metadataAttempt);
        const metadataPromise = abortable(async () => metadata ??
          providers.spotify.getTrackMetadata(trackId, accessToken, clientContext, { ...syllable, trace: metadataAttempt }), syllable.signal)
          .catch(() => {
            metadataAttempt.outcome = syllable.signal.aborted ? (syllable.signal.reason?.name === "TimeoutError" ? "timeout" : "cancelled") : "failed";
            return undefined;
          }).then(value => {
            metadataAttempt.durationMs = Date.now() - metadataStarted;
            if (metadataAttempt.outcome === "pending") metadataAttempt.outcome = value ? "success"
              : metadataAttempt.upstream.some(event => event.outcome === "timeout") ? "timeout"
              : metadataAttempt.upstream.some(event => event.outcome === "failed") ? "failed" : "none";
            if (!syllable.signal.aborted) {
              metadata = value;
              if (value && context.diagnostics) context.diagnostics.track = value;
            }
            return value;
          });
        const withMetadata = (request: (track: TrackMetadata, scope: RequestContext) => Promise<BeautifulLyrics | undefined>) =>
          async (scope: RequestContext) => {
            const track = await metadataPromise;
            syllable.signal.throwIfAborted();
            return track ? request(track, scope) : undefined;
          };
        const candidates = syllableCandidates;
        candidates.push(
          run("qq music", withMetadata((t, scope) => providers.qqmusic.getSyllableLyrics(t, scope)), syllable),
          run("kugou direct", withMetadata((t, scope) => providers.kugou.getSyllableLyrics(t, scope)), syllable),
          run("netease direct", withMetadata((t, scope) => providers.netease.getSyllableLyrics(t, scope)), syllable),
          run("apple music", withMetadata((t, scope) => providers.lyrically.getAppleMusicLyrics(t, scope)), syllable),
          run("kugou", withMetadata((t, scope) => providers.lyrically.getKugouLyrics(t, true, scope)), syllable),
          run("netease", withMetadata((t, scope) => providers.lyrically.getNeteaseLyrics(t, true, scope)), syllable),
          run("deezer", withMetadata((t, scope) => providers.lyrically.getDeezerLyrics(t, scope)), syllable)
        );
        // Musixmatch requests concurrently, but only wins once all preferred
        // syllable sources are exhausted (including their shared deadline).
        const preferredCandidates = [...candidates];
        const musixmatchRequest = run("musixmatch direct",
          withMetadata((t, scope) => providers.musixmatch.getSyllableLyrics(t, scope)), syllable);
        candidates.push(musixmatchRequest);
        const musixmatchResult = musixmatchRequest.catch(() => undefined);
        let winner = await first(preferredCandidates, lyrics => lyrics.Type === "Syllable");
        if (!winner) {
          const fallback = await musixmatchResult;
          if (fallback?.[1].Type === "Syllable") {
            const remaining = musixmatchEligibleAt - Date.now();
            if (remaining > 0) {
              let timer: ReturnType<typeof setTimeout> | undefined;
              try {
                await abortable(() => new Promise<void>(resolve => {
                  timer = setTimeout(resolve, remaining);
                }), syllable.signal);
                winner = fallback;
              } catch {
                // An interrupted hold must not bypass the delay via line fallback.
                available.delete("musixmatch direct");
              } finally { clearTimeout(timer); }
            } else {
              winner = fallback;
            }
          }
        }
        if (winner && isLiveTitle(matchedTitle(winner[1]) ?? metadata?.name ?? "")) {
          const alternativeScope = requestScope(2_000, syllable);
          try {
            const alternative = await abortable(() => Promise.any(preferredCandidates.map(async candidate => {
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
      } finally {
        syllable.cancel(); syllable.dispose();
        await Promise.allSettled(syllableCandidates);
      }
      if (context.signal?.aborted) return undefined;

      // Static responses are saved, never allowed to win against a pending line search.
      stage = "line";
      const line = requestScope(10_000, context);
      const lineCandidates: Promise<Candidate>[] = [];
      try {
        const track = metadata ?? { id: trackId, name: "", artists: [] };
        const candidates = lineCandidates;
        candidates.push(...[...available].filter(([, lyrics]) => lyrics.Type !== "Static")
          .map(result => Promise.resolve(result)));
        candidates.push(
          run("spotify proxy", scope => providers.lyrically.getLyrics(track, scope), line),
          run("spotify", scope => providers.spotify.getLyrics(trackId, accessToken, clientContext, scope), line)
        );
        if (metadata) {
          const knownTrack = metadata;
          candidates.push(
            run("kugou", scope => providers.lyrically.getKugouLyrics(knownTrack, false, scope), line),
            run("netease", scope => providers.lyrically.getNeteaseLyrics(knownTrack, false, scope), line),
            run("youtube", scope => providers.lyrically.getYouTubeLyrics(knownTrack, scope), line),
            run("lrclib", scope => providers.lrclib.getLyrics(knownTrack, scope), line)
          );
        }
        const winner = await first(candidates, lyrics => lyrics.Type !== "Static");
        if (winner) return finish(winner);
      } finally {
        line.cancel(); line.dispose();
        await Promise.allSettled(lineCandidates);
      }
      if (context.signal?.aborted) return undefined;

      const staticOrder = ["spotify proxy", "spotify", "deezer", "youtube", "genius", "lrclib", "apple music", "kugou", "netease"];
      for (const source of staticOrder) {
        const lyrics = available.get(source);
        if (lyrics?.Type === "Static") return finish([source, lyrics]);
      }
      if (!metadata) return undefined;
      stage = "static";
      const fallback = requestScope(5_000, context);
      try {
        return finish(await run("genius", scope => providers.lyrically.getGeniusLyrics(metadata!, scope), fallback)
          .catch(() => undefined));
      } finally { fallback.cancel(); fallback.dispose(); }
    }
  };
}
