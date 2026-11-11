import { WorkerEntrypoint } from "cloudflare:workers";
import { createWorker, defaultService, type WorkerEnv } from "./index";
import { createLyricsOrigin } from "./lyrics-origin";
import { trackCachePrefix, type OriginBinding } from "./cache";

const runOrigin = createLyricsOrigin(defaultService);

/** Only this named entrypoint is cached; no public route targets it. */
export class LyricsOrigin extends WorkerEntrypoint<WorkerEnv> {
  fetch(request: Request): Promise<Response> {
    return runOrigin(request, this.env, this.ctx);
  }
  async purgeTrack(trackId: string): Promise<void> {
    // Purges are scoped to the entrypoint that calls them.
    if (!this.ctx.cache) throw new Error("Lyrics cache is not configured");
    const result = await this.ctx.cache.purge({ pathPrefixes: [trackCachePrefix(trackId)] });
    if (!result.success) throw new Error("Lyrics cache purge failed");
  }
}

export default createWorker(defaultService, undefined, {
  origin(_env, ctx): OriginBinding {
    if (!ctx) throw new Error("Missing Worker context");
    const binding = ctx.exports.LyricsOrigin;
    return {
      fetch: (request, init) => binding.fetch(request, init),
      purgeTrack: trackId => binding.purgeTrack(trackId)
    };
  }
});
