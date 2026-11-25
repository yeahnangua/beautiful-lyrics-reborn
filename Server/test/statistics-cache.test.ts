import { afterEach, describe, expect, it, vi } from "vitest";
import { cachedStatistics } from "../src/statistics-cache";
afterEach(() => vi.unstubAllGlobals());
describe("statistics caching", () => {
  it("normalizes keys, coalesces concurrent misses and reuses public results", async () => {
    const entries = new Map<string,Response>();
    vi.stubGlobal("caches",{open:async()=>({match:async(key:Request)=>entries.get(key.url)?.clone(),put:async(key:Request,value:Response)=>{entries.set(key.url,value)}})});
    let release!:()=>void;
    const ready=new Promise<void>(resolve=>release=resolve);
    const generate=vi.fn(async(url:URL)=>{await ready;return Response.json({days:Number(url.searchParams.get("days"))})});
    const limiter={limit:vi.fn(async()=>({success:true}))};
    const a=cachedStatistics(new Request("https://stats.test/stats?days=30&ignored=a"),limiter,generate);
    const b=cachedStatistics(new Request("https://stats.test/stats?days=30&ignored=b"),limiter,generate);
    await vi.waitFor(()=>expect(generate).toHaveBeenCalledTimes(1));release();
    const responses=await Promise.all([a,b]);
    expect(responses[0]!.headers.get("Cache-Control")).toBe("public, max-age=120");
    expect(await responses[1]!.json()).toEqual({days:30});
    await cachedStatistics(new Request("https://stats.test/stats?days=30"),limiter,generate);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("does not query analytics for a rate-limited miss or cache failures", async()=>{
    vi.stubGlobal("caches",{open:async()=>({match:async()=>undefined,put:vi.fn()})});
    const generate=vi.fn(async()=>new Response("unavailable",{status:503}));
    expect((await cachedStatistics(new Request("https://stats.test/stats?days=7"),{limit:async()=>({success:false})},generate)).status).toBe(429);
    expect(generate).not.toHaveBeenCalled();
    expect((await cachedStatistics(new Request("https://stats.test/stats?days=7"),{limit:async()=>({success:true})},generate)).status).toBe(503);
  });
});
