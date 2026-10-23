// Fixed dimensions only; events never contain song, account, token or session identifiers.
export function createMetricsClient(runtime = globalThis, version = "unknown") {
  let queue = [], sending = false, stopped = false;
  const flush = async (leaving = false) => {
    if (sending || !queue.length || stopped) return;
    const events = queue.splice(0, 20);
    sending = true;
    try {
      await runtime.fetch("https://lyrics.txw.qzz.io/metrics", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schema: 1, events }), keepalive: leaving,
        signal: AbortSignal.timeout(5000), credentials: "omit",
      });
    } catch { /* Best effort, no retries or persistent queue. */ }
    finally { sending = false; }
  };
  const allowed = new Set(["session", "fullscreen_first", "lyrics_load", "lyrics_display", "fullscreen_load", "fullscreen_mode"]);
  const timer = runtime.setInterval(() => void flush(), 30000);
  const leave = () => void flush(true);
  runtime.addEventListener?.("pagehide", leave);
  return {
    emit(kind, dimensions = {}) {
      if (stopped || !allowed.has(kind)) return;
      const event = { kind, version };
      for (const key of ["durationMs", "source", "outcome", "lyricsType", "view", "mode"]) {
        if (dimensions[key] !== undefined) event[key] = dimensions[key];
      }
      if (queue.length < 100) queue.push(event);
      if (queue.length >= 20) void flush();
    },
    flush,
    destroy() { void flush(true); stopped = true; queue = []; runtime.clearInterval(timer); runtime.removeEventListener?.("pagehide", leave); },
  };
}
