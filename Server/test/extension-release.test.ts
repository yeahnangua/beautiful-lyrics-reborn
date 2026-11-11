import { describe, expect, it, vi } from "vitest";
import { createWorker } from "../src/index";

const request = (path: string) => new Request(`https://lyrics.txw.qzz.io/extension/${path}`, {
  headers: { "If-None-Match": "old-pointer" }
}) as Request<unknown, IncomingRequestCfProperties>;
function fixture() {
  const getLyrics = vi.fn();
  const fetch = vi.fn().mockResolvedValue(new Response('{"schema":1}'));
  return { worker: createWorker({ getLyrics }), getLyrics, fetch, env: { RELEASE_ASSETS: { fetch } as unknown as Fetcher } };
}
describe("extension releases", () => {
  it("serves current pointer without caching, conditional headers, or lyrics authentication", async () => {
    const f = fixture();
    f.fetch.mockResolvedValue(new Response('{"schema":1}', { headers: { "CF-Cache-Status": "HIT", "Age": "60" } }));
    const response = await f.worker.fetch!(request("latest.json?old=1"), f.env, {} as ExecutionContext);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("CDN-Cache-Control")).toBe("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.has("CF-Cache-Status")).toBe(false);
    expect(response.headers.has("Age")).toBe(false);
    expect(response.headers.has("X-Assets-Cache-Status")).toBe(false);
    expect(f.fetch.mock.calls[0]?.[0].url).toBe("https://lyrics.txw.qzz.io/latest.json");
    expect(f.fetch.mock.calls[0]?.[0].headers.has("If-None-Match")).toBe(false);
    expect(f.getLyrics).not.toHaveBeenCalled();
  });
  it.each(["beautiful-lyrics-reborn", "beautiful-lyrics-reborn-fullscreen"])("reports the underlying asset cache for %s without forwarding unrelated headers", async (name) => {
    const f = fixture();
    f.fetch.mockResolvedValue(new Response("export {};", { headers: {
      "CF-Cache-Status": "HIT", "Age": "123", "Set-Cookie": "internal=value"
    } }));
    const response = await f.worker.fetch!(request(`${name}.0123456789abcdef.mjs`), f.env, {} as ExecutionContext);
    expect(response.headers.get("CF-Cache-Status")).toBe("HIT");
    expect(response.headers.get("X-Assets-Cache-Status")).toBe("HIT");
    expect(response.headers.get("Age")).toBe("123");
    expect(response.headers.get("Access-Control-Expose-Headers")).toBe("CF-Cache-Status, Age, X-Assets-Cache-Status");
    expect(response.headers.get("Cache-Control")).toContain("immutable");
    expect(response.headers.has("Set-Cookie")).toBe(false);
    expect(await response.text()).toBe("export {};");
  });
  it("serves immutable JavaScript with CORS and the module MIME type", async () => {
    const f = fixture();
    const response = await f.worker.fetch!(request("beautiful-lyrics-reborn.0123456789abcdef.mjs"), f.env, {} as ExecutionContext);
    expect(response.headers.get("Cache-Control")).toContain("immutable");
    expect(response.headers.get("Content-Type")).toContain("text/javascript");
    expect(response.headers.get("X-Assets-Cache-Status")).toBe("UNKNOWN");
    expect(response.headers.has("CF-Cache-Status")).toBe(false);
    const fullscreen = await f.worker.fetch!(request("beautiful-lyrics-reborn-fullscreen.0123456789abcdef.mjs"), f.env, {} as ExecutionContext);
    expect(fullscreen.status).toBe(200);
    expect(fullscreen.headers.get("Cache-Control")).toContain("immutable");
  });
  it("does not cache missing assets or expose the bootstrap via this route", async () => {
    const f = fixture();
    f.fetch.mockResolvedValue(new Response("missing", { status: 404 }));
    const unavailable = await f.worker.fetch!(request("latest.json"), f.env, {} as ExecutionContext);
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("Cache-Control")).toBe("no-store");
    const denied = await f.worker.fetch!(request("beautiful-lyrics-reborn.mjs"), f.env, {} as ExecutionContext);
    expect(denied.status).toBe(404);
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
});
