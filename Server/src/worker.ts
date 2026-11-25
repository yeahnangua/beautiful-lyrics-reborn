import { WorkerEntrypoint } from "cloudflare:workers";
import { createWorker, defaultService, type WorkerEnv } from "./index";
import { createLyricsOrigin } from "./lyrics-origin";
import { cachePath, type CacheIdentity, type OriginBinding } from "./cache";

const runOrigin = createLyricsOrigin(defaultService);

/** Only this named entrypoint is cached; no public route targets it. */
export class LyricsOrigin extends WorkerEntrypoint<WorkerEnv> {
  fetch(request: Request): Promise<Response> {
    return runOrigin(request, this.env);
  }
  async purgeEntry(identity: CacheIdentity): Promise<void> {
    // Purges are scoped to the entrypoint that calls them.
    if (!this.ctx.cache) throw new Error("Lyrics cache is not configured");
    // Both hashes have fixed width, so this prefix identifies exactly one entry.
    if (!/^[a-f0-9]{64}$/.test(identity.metadataHash) || !/^[a-f0-9]{64}$/.test(identity.policyHash)) throw Error("Invalid cache key");
    const result = await this.ctx.cache.purge({ pathPrefixes: [cachePath(identity)] });
    if (!result.success) throw new Error("Lyrics cache purge failed");
  }
}

export default createWorker(defaultService, undefined, {
  origin(_env, ctx): OriginBinding {
    if (!ctx) throw new Error("Missing Worker context");
    const binding = ctx.exports.LyricsOrigin;
    return {
      fetch: (request, init) => binding.fetch(request, init),
      purgeEntry: identity => binding.purgeEntry(identity)
    };
  }
});
