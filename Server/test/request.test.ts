import { describe, expect, it, vi } from "vitest";
import { contextFetch, withLyricRequestRetries } from "../src/providers/request";

describe("request cancellation", () => {
  it("bounds the response body as well as the headers", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const fetcher = contextFetch(vi.fn(async (_, init) => {
        signal = init?.signal as AbortSignal;
        return new Response(new ReadableStream({ start() {} }));
      }) as typeof fetch);
      const result = expect(fetcher("https://example.test")).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(5_000); await result;
      expect(signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("does not retry past the caller deadline", async () => {
    vi.useFakeTimers();
    try {
      const operation = vi.fn(() => new Promise<never>(() => {}));
      const result = expect(withLyricRequestRetries(operation, "test", { deadline: Date.now() + 6_000 })).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(6_000); await result;
      expect(operation).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});

describe("structured upstream diagnostics", () => {
  const attempt = () => ({ provider: "test", stage: "line" as const, startedAt: new Date().toISOString(), durationMs: 0,
    outcome: "pending" as const, retries: 0, upstream: [] as import("../src/types").UpstreamEvent[] });
  it("records status and duration while stripping credentials and URL queries", async () => {
    const trace = attempt();
    await contextFetch(vi.fn(async () => new Response("ignored", { status: 429 })) as typeof fetch, { trace })(
      "https://example.test/download?accesskey=SECRET&token=PRIVATE", { headers: { Authorization: "Bearer SECRET", Cookie: "PRIVATE" } });
    expect(trace.upstream).toEqual([{ endpoint: "example.test/download", durationMs: expect.any(Number), status: 429, outcome: "failed" }]);
    expect(JSON.stringify(trace)).not.toMatch(/SECRET|PRIVATE|accesskey|Authorization|Cookie/);
  });
  it("tracks retries and distinguishes body timeouts from cancellation", async () => {
    vi.useFakeTimers();
    try {
      const trace = attempt();
      const result = expect(withLyricRequestRetries(() => new Promise<never>(() => {}), "test", { trace })).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(15_000); await result;
      expect(trace.retries).toBe(2);
      const timeoutTrace = attempt();
      const timeout = expect(contextFetch(vi.fn(async () => new Response(new ReadableStream({ start() {} }))) as typeof fetch,
        { trace: timeoutTrace })("https://example.test/lyrics")).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(5000); await timeout;
      expect(timeoutTrace.upstream[0]?.outcome).toBe("timeout");
      const cancellationTrace = attempt();
      const controller = new AbortController();
      const cancelled = expect(contextFetch(vi.fn(async () => new Promise<Response>(() => {})) as typeof fetch,
        { signal: controller.signal, trace: cancellationTrace })("https://example.test/lyrics")).rejects.toThrow();
      controller.abort(); await cancelled;
      expect(cancellationTrace.upstream[0]?.outcome).toBe("cancelled");
    } finally { vi.useRealTimers(); }
  });
});
