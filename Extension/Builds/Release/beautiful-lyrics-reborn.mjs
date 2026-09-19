// The Marketplace entry stays at a stable path; only immutable payloads change.
export async function startReleaseLoader(fallback, runtime = globalThis) {
  const stateKey = "__beautifulLyricsRebornLoader";
  if (runtime[stateKey]) return;
  const state = runtime[stateKey] = { status: "loading", build: undefined };
  const base = "https://lyrics.txw.qzz.io/extension/";
  const cdn = "https://cdn.jsdelivr.net/gh/yeahnangua/beautiful-lyrics-reborn@main/Extension/Builds/Release/";
  const storageKey = "beautiful-lyrics-reborn:last-release";
  const valid = (value) => value?.schema === 1 && /^\d+\.\d+\.\d+$/.test(value.version)
    && /^[a-f0-9]{64}$/.test(value.sha256)
    && value.file === `beautiful-lyrics-reborn.${value.sha256.slice(0, 16)}.mjs`;
  const readStored = () => {
    try { return JSON.parse(runtime.localStorage.getItem(storageKey)); } catch { return undefined; }
  };
  const latest = async () => {
    const response = await runtime.fetch(`${base}latest.json`, {
      cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Version check failed (${response.status})`);
    const release = await response.json();
    if (!valid(release)) throw new Error("Invalid release descriptor");
    return release;
  };
  const download = async (release) => {
    for (const origin of [base, cdn]) {
      try {
        const response = await runtime.fetch(origin + release.file, { signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error(`Bundle download failed (${response.status})`);
        const bytes = await response.arrayBuffer();
        const digest = await runtime.crypto.subtle.digest("SHA-256", bytes);
        const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
        if (hash !== release.sha256) throw new Error("Bundle checksum mismatch");
        return bytes;
      } catch (error) { runtime.console.warn("[Beautiful Lyrics Reborn]", error); }
    }
    throw new Error(`Unable to download build ${release.sha256.slice(0, 16)}`);
  };
  try {
    let remote;
    try { remote = await latest(); } catch (error) { runtime.console.warn("[Beautiful Lyrics Reborn]", error); }
    const candidates = [remote, readStored(), fallback].filter(valid);
    let selected, bytes;
    const attempted = new Set();
    for (const release of candidates) {
      if (attempted.has(release.sha256)) continue;
      attempted.add(release.sha256);
      try { bytes = await download(release); selected = release; break; } catch (error) {
        runtime.console.warn("[Beautiful Lyrics Reborn]", error);
      }
    }
    if (!selected) throw new Error("No available release");
    // Never execute another bundle after evaluation begins: a failing module may
    // already have registered listeners or styles. Reload is the safe recovery.
    const url = runtime.URL.createObjectURL(new Blob([bytes], { type: "text/javascript" }));
    try { await (runtime.importModule ?? (url => import(url)))(url); }
    finally { runtime.URL.revokeObjectURL(url); }
    state.status = "loaded";
    state.build = selected.sha256;
    state.version = selected.version;
    try { runtime.localStorage.setItem(storageKey, JSON.stringify(selected)); } catch { /* Storage may be unavailable. */ }
    runtime.console.info(`[Beautiful Lyrics Reborn] ${selected.version} (${selected.sha256.slice(0, 16)})`);
    let checking = false, notified;
    runtime.setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const release = await latest();
        if (release.sha256 !== state.build && release.sha256 !== notified && runtime.Spicetify?.showNotification) {
          runtime.Spicetify.showNotification("Beautiful Lyrics Reborn has an update. Reload Spotify to apply it.", false, 10000);
          notified = release.sha256;
        }
      } catch { /* Keep the active version when the update service is unavailable. */ }
      finally { checking = false; }
    }, 5 * 60 * 1000);
  } catch (error) {
    state.status = "failed";
    runtime.console.error("[Beautiful Lyrics Reborn] Load failed; reload Spotify to retry.", error);
    runtime.Spicetify?.showNotification?.("Beautiful Lyrics Reborn could not load. Reload Spotify to retry.", true, 10000);
  }
}

await startReleaseLoader({"schema":1,"version":"5.2.2","sha256":"19a0201b267b70e4e29ecc91f769badbcbf77e073846b64c4ec2e1312ad503c7","file":"beautiful-lyrics-reborn.19a0201b267b70e4.mjs"});
