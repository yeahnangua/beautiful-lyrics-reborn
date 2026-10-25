// The Marketplace entry stays at a stable path; only immutable payloads change.
export async function startReleaseLoader(fallback, runtime = globalThis) {
  const stateKey = "__beautifulLyricsRebornLoader";
  if (runtime[stateKey]) return;
  const state = runtime[stateKey] = { status: "loading", build: undefined };
  const base = "https://lyrics.txw.qzz.io/extension/";
  const domestic = "https://lyrics.20050129.xyz/extension/";
  const cdn = "https://cdn.jsdelivr.net/gh/yeahnangua/beautiful-lyrics-reborn@main/Extension/Builds/Release/";
  const storageKey = "beautiful-lyrics-reborn:last-release";
  const headers = { "User-Agent": "beautiful-lyrics-reborn" };
  const valid = (value) => value?.schema === 1 && /^\d+\.\d+\.\d+$/.test(value.version)
    && /^[a-f0-9]{64}$/.test(value.sha256)
    && value.file === `beautiful-lyrics-reborn.${value.sha256.slice(0, 16)}.mjs`;
  const readStored = () => {
    try { return JSON.parse(runtime.localStorage.getItem(storageKey)); } catch { return undefined; }
  };
  const latest = async () => {
    const response = await runtime.fetch(`${base}latest.json`, {
      cache: "no-store", signal: AbortSignal.timeout(10000),
      headers,
    });
    if (!response.ok) throw new Error(`Version check failed (${response.status})`);
    const release = await response.json();
    if (!valid(release)) throw new Error("Invalid release descriptor");
    return release;
  };
  const downloadFrom = async (origin, release, controller = new AbortController()) => {
    const { signal } = controller;
    const timer = (runtime.setTimeout ?? globalThis.setTimeout)(() => {
      controller.abort(new DOMException("Bundle download timed out", "TimeoutError"));
    }, 60000);
    let onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([aborted, (async () => {
        const response = await runtime.fetch(origin + release.file, { signal, headers });
        if (!response.ok) throw new Error(`Bundle download failed (${response.status})`);
        const bytes = await response.arrayBuffer();
        const digest = await runtime.crypto.subtle.digest("SHA-256", bytes);
        const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
        signal.throwIfAborted();
        if (hash !== release.sha256) throw new Error("Bundle checksum mismatch");
        return bytes;
      })()]);
    } finally {
      (runtime.clearTimeout ?? globalThis.clearTimeout)(timer);
      signal.removeEventListener("abort", onAbort);
    }
  };
  const download = async (release) => {
    const controllers = [new AbortController(), new AbortController()];
    let winner;
    try {
      // Compete on verified bytes, not response headers or unverified downloads.
      winner = await Promise.any([base, domestic].map(async (origin, index) => ({
        bytes: await downloadFrom(origin, release, controllers[index]),
        controller: controllers[index],
      })));
      return winner.bytes;
    } catch (error) {
      runtime.console.warn("[Beautiful Lyrics Reborn] Both download routes failed.", error);
    } finally {
      for (const controller of controllers) {
        if (controller !== winner?.controller) controller.abort();
      }
    }
    try { return await downloadFrom(cdn, release); }
    catch (error) { runtime.console.warn("[Beautiful Lyrics Reborn]", error); }
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
    let checking = false, updateNoticeShown = false, updateNoticeDismissed = false;
    runtime.setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const release = await latest();
        const snackbar = runtime.Spicetify?.Snackbar;
        const react = runtime.Spicetify?.React;
        if (release.sha256 !== state.build && !updateNoticeShown && !updateNoticeDismissed
          && snackbar?.enqueueSnackbar && snackbar?.closeSnackbar && react?.createElement) {
          let noticeKey;
          const notice = react.createElement("div", { style: { display: "flex", alignItems: "center", gap: "12px" } },
            react.createElement("span", null, "Beautiful Lyrics Reborn has an update. Reload Spotify to apply it."),
            react.createElement("button", {
              type: "button",
              "aria-label": "Dismiss update notification",
              title: "Dismiss update notification",
              style: { background: "none", border: 0, color: "inherit", cursor: "pointer", fontSize: "20px", lineHeight: 1, padding: "0 4px" },
              onClick: () => {
                updateNoticeDismissed = true;
                snackbar.closeSnackbar(noticeKey);
              },
            }, "×"));
          noticeKey = snackbar.enqueueSnackbar(notice, { persist: true });
          updateNoticeShown = true;
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
