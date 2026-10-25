// No cache or network work happens until load() is called by a fullscreen entry.
export function createFullscreenLoader(release, runtime = globalThis) {
  let module, pending, pendingSignal;
  const origins = ["https://lyrics.txw.qzz.io/extension/", "https://lyrics.20050129.xyz/extension/"];
  const cdn = "https://cdn.jsdelivr.net/gh/yeahnangua/beautiful-lyrics-reborn@main/Extension/Builds/Release/";
  const cacheKey = origins[0] + release.file;
  const valid = () => release.api === 1 && /^[a-f0-9]{64}$/.test(release.sha256)
    && release.file === `beautiful-lyrics-reborn-fullscreen.${release.sha256.slice(0, 16)}.mjs`;
  const verified = async bytes => {
    const digest = await runtime.crypto.subtle.digest("SHA-256", bytes);
    if (Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("") !== release.sha256) throw Error("Fullscreen checksum mismatch");
    return bytes;
  };
  const storageOperation = async operation => {
    let timer;
    try { return await Promise.race([operation(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Cache timed out')), 2000); })]); }
    finally { clearTimeout(timer); }
  };
  async function download(origin, parent) {
    const signal = AbortSignal.any([parent, AbortSignal.timeout(60000)]);
    let listener;
    const aborted = new Promise((_, reject) => {
      listener = () => reject(signal.reason);
      signal.addEventListener("abort", listener, { once: true });
      if (signal.aborted) listener();
    });
    try {
      return await Promise.race([aborted, (async () => {
        signal.throwIfAborted();
        const response = await runtime.fetch(origin + release.file, { signal, headers: { "User-Agent": "beautiful-lyrics-reborn" } });
        if (!response.ok) throw Error("Fullscreen download failed");
        const bytes = await verified(await response.arrayBuffer());
        signal.throwIfAborted();
        return bytes;
      })()]);
    } finally { signal.removeEventListener("abort", listener); }
  }
  async function start(signal) {
    if (!valid()) throw Error("Invalid fullscreen descriptor");
    let cache, bytes, source = "network";
    try {
      cache = await storageOperation(() => runtime.caches?.open("BeautifulLyrics/Fullscreen/v1"));
      const cached = await storageOperation(() => cache?.match(cacheKey));
      if (cached) {
        try { bytes = await storageOperation(async () => verified(await cached.arrayBuffer())); source = "cache"; }
        catch { await storageOperation(() => cache.delete(cacheKey)); }
      }
    } catch { /* Restricted storage does not prevent a network load. */ }
    signal.throwIfAborted();
    if (!bytes) {
      const controllers = origins.map(() => new AbortController());
      const cancel = () => controllers.forEach(c => c.abort(signal.reason));
      signal.addEventListener("abort", cancel, { once: true });
      try {
        bytes = await Promise.any(origins.map((origin, i) => download(origin, controllers[i].signal)));
      } catch {
        signal.throwIfAborted();
        bytes = await download(cdn, signal);
      } finally { cancel(); signal.removeEventListener("abort", cancel); }
      signal.throwIfAborted();
      try {
        await storageOperation(() => cache?.put(cacheKey, new Response(bytes, { headers: { "Content-Type": "text/javascript" } })));
        // Keep the three most recently used runtime payloads, including shared versions.
        const keys = await storageOperation(() => cache?.keys());
        for (const key of (keys ?? []).filter(key => key.url !== cacheKey).slice(0, Math.max(0, (keys?.length ?? 0) - 3))) await storageOperation(() => cache.delete(key));
      } catch { /* Cache quota failures leave this session usable. */ }
    }
    signal.throwIfAborted();
    const url = runtime.URL.createObjectURL(new Blob([bytes], { type: "text/javascript" }));
    try {
      const loaded = await (runtime.importModule ?? (url => import(/* @vite-ignore */ url)))(url);
      if (typeof loaded.mountFolia !== "function") throw Error("Invalid fullscreen interface");
      module = loaded;
      signal.throwIfAborted();
      return { ...module, source };
    } finally { runtime.URL.revokeObjectURL(url); }
  }
  return async function load(signal) {
    signal.throwIfAborted();
    if (module) return { ...module, source: "memory" };
    if (pendingSignal?.aborted) pending = undefined;
    // The host owns one cancellable request; repeated entries reuse its promise.
    if (!pending) {
      pendingSignal = signal;
      let listener;
      const aborted = new Promise((_, reject) => {
        listener = () => reject(signal.reason);
        signal.addEventListener('abort', listener, { once: true });
      });
      const request = Promise.race([start(signal), aborted]).finally(() => {
        signal.removeEventListener('abort', listener);
        if (pending === request) pending = undefined;
      });
      pending = request;
    }
    return pending;
  };
}
