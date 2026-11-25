import { describe, it, expect, vi } from "vitest";
import { clientNetwork, readBoundedBody, validateLyricsInput } from "../src/request-boundaries";
import { RequestScheduler } from "../src/providers/request-scheduler";
import { createLrclibProvider } from "../src/providers/lrclib";
import { decryptQrcHex } from "../src/providers/qqmusic";
import { encryptQrc } from "qrc-decoder";
import { contextFetch } from "../src/providers/request";

describe("request boundaries", () => {
  it("groups privacy addresses and IPv4-mapped addresses consistently", () => {
    const key = (ip: string) => clientNetwork(new Request("https://test/", { headers: { "CF-Connecting-IP": ip } }));
    expect(key("2001:db8:1:2::1234")).toBe(key("2001:0db8:0001:0002:ffff:eeee:1234:5678"));
    expect(key("2001:db8:1:3::1")).not.toBe(key("2001:db8:1:2::1"));
    expect(key("::ffff:192.0.2.1")).toBe(key("192.0.2.1"));
    expect(key("::ffff:c000:201")).toBe(key("192.0.2.1"));
  });
  it("rejects unbounded metadata and client headers", () => {
    for (const query of ["track_name=" + "x".repeat(501), Array(31).fill("artist_name=a").join("&"), "apple_id=" + "1".repeat(25)]) {
      const request = new Request("https://test/lyrics/id?" + query);
      expect(() => validateLyricsInput(request, new URL(request.url))).toThrow();
    }
    const request = new Request("https://test/lyrics/id", { headers: { "X-Spotify-App-Version": "x".repeat(65) } });
    expect(() => validateLyricsInput(request, new URL(request.url))).toThrow();
  });
  it("cancels an oversized chunked upstream body", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(100)); }, cancel }));
    await expect(readBoundedBody(response, 150)).rejects.toThrow("too large");
    expect(cancel).toHaveBeenCalled();
  });
  it("bounds inflated QRC bytes", () => {
    expect(decryptQrcHex(encryptQrc("a".repeat(1_048_577)))).toBeUndefined();
    expect(decryptQrcHex(encryptQrc("<lyrics>safe</lyrics>"))).toBe("<lyrics>safe</lyrics>");
  });
  it("queues at five requests and removes cancelled waiters", async () => {
    const scheduler = new RequestScheduler(), signal = new AbortController().signal;
    const held = await Promise.all(Array.from({ length: 5 }, () => scheduler.acquire(signal)));
    const controller = new AbortController();
    const queued = scheduler.acquire(controller.signal);
    controller.abort();
    await expect(queued).rejects.toThrow();
    let acquired = false;
    const sixth = scheduler.acquire(signal).then(release => { acquired = true; release(); });
    await Promise.resolve(); expect(acquired).toBe(false);
    held[0]!(); await sixth; expect(acquired).toBe(true);
    held.forEach(release => release());
  });
  it("rejects wrong LRCLIB recordings and prefers synced lyrics", async () => {
    const base = { id: 1, trackName: "Song", artistName: "Singer", duration: 100 };
    const provider = createLrclibProvider(vi.fn(async () => Response.json([
      { ...base, id: 2, artistName: "Other", syncedLyrics: "[00:01]wrong" },
      { ...base, plainLyrics: "plain" },
      { ...base, id: 3, syncedLyrics: "[00:01]right" },
    ])));
    expect(await provider.getLyrics({ id: "id", name: "Song", artists: ["Singer"], durationSeconds: 100 })).toMatchObject({ Type: "Line", Source: { TrackId: "3" } });
  });
  it("reuses a NetEase response across stages and reserves the line request budget", async () => {
    const scheduler = new RequestScheduler();
    const fetch = vi.fn(async () => Response.json({lrc:{lyric:"line"}}));
    const first = contextFetch(fetch,{scheduler});
    expect(await (await first("https://music.163.com/api/song/lyric/v1?id=1")).json()).toMatchObject({lrc:{lyric:"line"}});
    const second = contextFetch(fetch,{scheduler});
    expect(await (await second("https://music.163.com/api/song/lyric/v1?id=1")).json()).toMatchObject({lrc:{lyric:"line"}});
    expect(fetch).toHaveBeenCalledTimes(1);
    const signal = new AbortController().signal;
    for(let i=0;i<27;i++)(await scheduler.acquire(signal,"syllable"))();
    await expect(scheduler.acquire(signal,"syllable")).rejects.toThrow("budget");
    for(let i=0;i<12;i++)(await scheduler.acquire(signal,"line"))();
    await expect(scheduler.acquire(signal,"line")).rejects.toThrow("budget");
  });
});
