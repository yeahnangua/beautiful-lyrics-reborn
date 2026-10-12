# Folia fullscreen integration

The Spicetify fullscreen host mounts an isolated React root in a Shadow DOM. Playback, lyrics fetching, navigation and feedback remain owned by Beautiful Lyrics Reborn. The copied visualizers come from [Folia](https://github.com/chthollyphile/folia-major), revision `43605cd8e562b7aa0e5897478856ce3604a054a1` (0.7.18).

The 13 modes are Classic, Cadenza, Partita, Cappella, Tilt, Claddagh, Monet, Diorama, Pendolo, Sonnet, Tempera, Lumiere and Still. The five backgrounds are Common, Latent, Monet, Nomand and Sora. Defaults are Classic, Latent and Folia's Midnight theme, with lyrics visible and subtitles hidden. Explicitly saved subtitle preferences are respected. Mode, background, font size and display switches are stored under `BeautifulLyrics/FoliaFullscreen/v1`. A saved Fume selection falls back to Classic because Fume is excluded from this integration.

## Build and verify

Node.js 24+ and Deno 2 are required. From this directory:

```sh
npm ci
npm run build
npm run typecheck
npx playwright install chromium
npm run test:ui
```

From `Extension/`, `deno task offline` creates `Builds/Offline/beautiful-lyrics-reborn.mjs` without installing or changing Spotify. The existing `deno task release` builds the immutable payload and loader. Both run the Folia build automatically. `deno task test --port=3001` retains the existing Spicetify test server flow. After editing Folia source, press Enter in that test server to rebuild; its browser preview uses the compiled module, not HMR.

From the repository root, `node --test Extension/Tests/*.test.mjs` verifies the converter, audio analysis, library bridge, existing runtime and release loader. The browser fixture in `tests/` consumes the actual production module with local data; it does not contact Spotify or the lyrics service. It is excluded from the production library entry.

## Host boundary

`src/contracts.ts` contains dependency-free snapshots, actions and mount handles shared with the Deno host. `src/lyrics.ts` preserves syllable times, spacing, overlapping vocals and singer identity, and leaves interludes as gaps. Untimed lyrics use a scrollable full-text surface. `src/model.ts` advances precise clocks and audio proxies through MotionValues; only active-line and discrete UI changes notify React.

`src/audio.ts` uses Spicetify track analysis to derive loudness and beat envelopes. Band inputs are proxies, not measured frequency bands; no FFT is synthesized. Missing APIs, unsupported tracks, invalid data and a 6.5-second deadline fall back to zero input. The lyric clock includes the saved offset; audio analysis and the progress bar use the unshifted playback clock.

The native full-screen and cinema entries continue to use `/BeautifulLyrics/Fullscreen`. Escape closes an open panel before closing the view. Render errors or context loss fall back to Still while preserving playback controls. Closing the host unmounts the React tree and releases subscriptions, timers, observers and rendering resources.

## Upstream adaptations and licenses

`vendor/provenance.json` records the copied paths and upstream revision. Renderer code and annotations are retained. Entry modules expose renderers without the full application's settings panels. The shared shell omits Folium and local video layers; Sonnet uses no mod multipliers. The bottom subtitle layout no longer imports the application's settings store. Custom Tempera image storage is an empty pool in this integration. Diorama uses a standalone interlude predicate instead of importing the upstream parser. Pixi initialization failures notify the host's fallback boundary. Reduced-motion decisions retain Folia's default animation behavior without changing Spotify's document attributes.

Folia's AGPL license is preserved in `vendor/LICENSE`, and the original avatar/emoji notices accompany the images. Build output includes `dist/THIRD_PARTY_NOTICES.txt`, assembled from the license files of bundled packages. These notices are also embedded in the single extension payload. No files under the original temporary checkout are required for building or running the extension.

The Vite build adapts Paper Shader's style injection to use the canvas's Shadow Root. This keeps its required full-size canvas rules inside the isolated surface and avoids document-level stylesheet changes.

The alternate-text helper retains Reborn's translation-only subtitle policy. Transliteration controls, engines and dictionaries remain absent from the payload.
