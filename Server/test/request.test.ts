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
