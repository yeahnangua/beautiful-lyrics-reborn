import { clientNetwork } from "./request-boundaries";

const pending = new Map<string, Promise<Response>>();
/** Public aggregate data only; cache keys ignore all unknown query parameters. */
export async function cachedStatistics(request: Request, limiter: RateLimit | undefined,
  generate: (url: URL) => Promise<Response>): Promise<Response> {
  const url = new URL(request.url);
  const value = Number(url.searchParams.get("days"));
  const days = Number.isFinite(value) && value > 0 ? Math.min(90, Math.max(1, Math.floor(value))) : 30;
  const key = new Request(`${url.origin}/stats?days=${days}`);
  const cache = typeof caches === "undefined" ? undefined : await caches.open("lyrics-statistics-v1").catch(() => undefined);
  const hit = await cache?.match(key).catch(() => undefined);
  if (hit) return hit;
  const current = pending.get(key.url);
  if (current) return (await current).clone();
  if (!limiter || !(await limiter.limit({ key: clientNetwork(request) })).success) {
    return new Response("Statistics temporarily unavailable", { status: limiter ? 429 : 503, headers: { "Retry-After": "60", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
  }
  // Re-check after awaiting the limiter so simultaneous callers share the fill.
  const raced = pending.get(key.url);
  if (raced) return (await raced).clone();
  const fill = (async () => {
    const response = await generate(new URL(key.url));
    if (response.ok) {
      response.headers.set("Cache-Control", "public, max-age=120");
      await cache?.put(key, response.clone()).catch(() => {});
    }
    return response;
  })();
  pending.set(key.url, fill);
  try { return (await fill).clone(); }
  finally { if (pending.get(key.url) === fill) pending.delete(key.url); }
}
