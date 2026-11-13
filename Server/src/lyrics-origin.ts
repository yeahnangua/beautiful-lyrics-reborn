import { Abortable, CreateAbortScope } from "../../Universal/Modules/Async";
import { cacheTtlMs, isCacheableLyrics, lyricsCacheVersion, originBudgetMs, readOriginRequest, stripRequestFields, type OriginEnvelope } from "./cache";
import { hashLyrics, logLyricsQuery, saveOriginDiagnostics } from "./diagnostics";
import { recordProviderMetrics, type MetricsEnv } from "./metrics";
import { setSpicyLyricsApiKey } from "./providers/spicylyrics";
import { isSourceBlocked } from "./source-policy";
import type { LyricsService } from "./service";
import type { BeautifulLyrics, RequestDiagnostics } from "./types";

export type LyricsOriginEnv = MetricsEnv & { FEEDBACK_DB?: D1Database; SPICY_LYRICS_KEY?: string };

export function keepAlive(ctx: Pick<ExecutionContext, "waitUntil"> | undefined, pending: Promise<unknown>): void {
  // Consumers may stop waiting, but one disconnected caller must not cancel a
  // bounded fill shared by the other requests waiting in Workers Cache.
  if (ctx?.waitUntil) ctx.waitUntil(pending.catch(() => {}));
}

export function createLyricsOrigin(service: LyricsService) {
  return async function originFetch(request: Request, env: LyricsOriginEnv, ctx?: ExecutionContext): Promise<Response> {
    let input;
    try { input = await readOriginRequest(request); }
    catch { return new Response("Invalid internal request", { status: 400, headers: { "Cache-Control": "no-store" } }); }
    const started = Date.now();
    const record: RequestDiagnostics = {
      id: crypto.randomUUID(), triggerRequestId: input.triggerRequestId,
      track: input.metadata ?? { id: input.trackId, name: "", artists: [] },
      startedAt: new Date(started).toISOString(), durationMs: 0, outcome: "pending", cache: "miss",
      attempts: [], sourceBlocks: input.sourceBlocks, sourcePolicyStatus: "applied", cacheVersion: lyricsCacheVersion
    };
    record.originRunId = record.id;
    const scope = CreateAbortScope(Math.max(0, Math.min(originBudgetMs, input.deadline - started)));
    let lyrics: BeautifulLyrics | undefined;
    let failed = false;
    try {
      setSpicyLyricsApiKey(env.SPICY_LYRICS_KEY);
      lyrics = await Abortable(scope.Signal, () => service.getLyrics(input.trackId, input.accessToken, input.metadata,
        input.clientContext, { signal: scope.Signal, deadline: scope.Deadline, diagnostics: record, sourceBlocks: input.sourceBlocks }));
      scope.Signal.throwIfAborted();
      if (lyrics) {
        lyrics = stripRequestFields(lyrics);
        if (!isCacheableLyrics(lyrics) || !lyrics.Source || isSourceBlocked(input.sourceBlocks, lyrics.Source.Provider, lyrics.Type)) {
          throw new Error("Unusable source");
        }
        record.source = lyrics.Source;
        record.lyricsHash = await hashLyrics(lyrics);
      }
      record.outcome = lyrics ? "success" : "none";
    } catch {
      record.outcome = "failed";
      failed = true;
      lyrics = undefined;
    } finally {
      scope.Destroy();
      await Promise.resolve();
      record.durationMs = Date.now() - started;
      logLyricsQuery(record, lyrics?.Type);
      recordProviderMetrics(env, record);
    }
    const generatedAt = Date.now();
    const envelope: OriginEnvelope = {
      schema: lyricsCacheVersion, trackId: input.trackId, metadataHash: input.metadataHash, policyHash: input.policyHash,
      outcome: failed ? "failed" : lyrics ? "success" : "none", originRunId: record.id, generatedAt,
      ...(lyrics ? { lyrics, lyricsHash: record.lyricsHash!, expiresAt: generatedAt + cacheTtlMs(lyrics.Type, lyrics.Source?.Provider) } : {})
    };
    const pending = saveOriginDiagnostics(env.FEEDBACK_DB, structuredClone(record))
      .catch(() => console.warn("Lyrics origin diagnostics write failed"));
    if (ctx?.waitUntil) keepAlive(ctx, pending);
    else await pending;
    return Response.json(envelope, {
      status: failed ? 502 : 200,
      headers: { "Cache-Control": lyrics ? "public, max-age=" + cacheTtlMs(lyrics.Type, lyrics.Source?.Provider) / 1000 + ", must-revalidate" : "no-store" }
    });
  };
}
