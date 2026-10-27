# Beautiful Lyrics Reborn

Beautiful Lyrics Reborn is a community-maintained revival of the original
Beautiful Lyrics Spicetify extension. It keeps the fullscreen/card/page lyric
experience alive and adds a new Cloudflare Worker lyrics service for Spicy Lyrics,
Spotify, QQ Music, KuGou, NetEase, Musixmatch, Lyrically/Paxsenix, and LRCLIB fallbacks.

This repository contains both pieces:

- `Extension/`: the Spicetify extension.
- `Server/`: the Cloudflare Worker lyrics API used by the extension.

The public Worker used by this build is:

```text
https://lyrics.txw.qzz.io
```

## Features

- Karaoke, line-synced, and static lyric rendering.
- Fullscreen and page lyric views.
- Dynamic cover-art based backgrounds.
- Folia fullscreen with 13 switchable lyric visualizers, five backgrounds, a floating playback capsule, and saved font/display preferences. Subtitles are hidden by default.
- Online releases load the complete fullscreen runtime only when fullscreen/cinema is opened, with verified persistent caching. Offline bundles remain self-contained.
- The statistics page includes provider performance, weighted latency percentiles, cache reuse and fullscreen usage. Aggregate plugin metrics are always enabled; no song, lyric, account, token or persistent user identifier is sent. See [loading and statistics details](docs/fullscreen-loading-and-statistics.md).
- Reborn lyrics provider flow:
  1. The first available syllable lyrics from direct Spicy Lyrics, QQ Music QRC, KuGou KRC, NetEase YRC,
     or Musixmatch RichSync, plus Lyrically/Paxsenix Apple Music, Kugou,
     NetEase, and Deezer; syllable providers are queried concurrently.
  2. The first available line lyrics from Lyrically/Paxsenix Spotify proxy,
     Kugou, Spotify, Deezer, YouTube, or LRCLIB; Line providers are queried concurrently.
  3. Static fallbacks from Spicy Lyrics, Lyrically/Paxsenix Spotify proxy, Spotify,
     Deezer, YouTube, Genius, and LRCLIB.

Lyrics preserve the quality order syllable > line > static. The syllable phase
(including metadata) has a 15-second budget, followed by up to 10 seconds for
line lyrics. Static results are used only after both phases miss or time out;
a final static lookup has at most 5 seconds.

The direct KuGou, NetEase, and Musixmatch providers do not use Paxsenix. KuGou and
NetEase match the title, artist, and duration before retrieving KRC or YRC.
KuGou decodes native word timings and skips unverified UGC candidates.
Musixmatch acquires and caches an anonymous token, sends the Spotify track URI
to improve matching, and
uses RichSync only when the track has word timing. A missing or restricted result
leaves the other providers available. Upstream availability and rate limits can
vary by server IP; no user credentials are bundled with these providers.

Spicy Lyrics is keyed by Spotify track ID and needs a secret API key. When the
`SPICY_LYRICS_KEY` Worker secret is unset, the provider is skipped entirely. See
[docs/spicylyrics.md](docs/spicylyrics.md) for setup and the binding attribution requirement.

## Local Extension Install

The fullscreen integration requires Node.js 24+ and Deno 2. Install its build dependencies once:

```bash
cd Extension/Folia
npm ci
```

To build an installable file without changing Spotify, run `deno task offline` in
`Extension/`. The result is `Extension/Builds/Offline/beautiful-lyrics-reborn.mjs`.
See [the Folia integration guide](Extension/Folia/README.md) for controls, build
verification, and the Spotify analysis fallback.

```bash
cd Extension
printf "import { Store } from './Spices/Debug/StoreLocally.ts';\nawait Store();\n" | deno run -A -
```

This builds an offline Spicetify extension and enables
`beautiful-lyrics-reborn.mjs`.

## Server Development

Explicit HTTP requests made by the extension (lyrics, policy, feedback, iTunes,
Spotify fetches, metrics, and release/fullscreen checks/downloads) and Worker upstream requests include
`beautiful-lyrics-reborn` in `User-Agent`. Existing provider-specific user agents
are preserved and extended. Spotify's Chromium runtime may discard a custom
`User-Agent`; this does not override the client's global user agent or the headers
of resources loaded by the browser (such as images, fonts, and module imports) or
Spotify's internal platform APIs.

```bash
cd Server
npm install
npm run dev
```

The local Worker listens on `http://localhost:8787`.

Run checks:

```bash
cd Server
npm test
npm run typecheck
```

Deploy to Cloudflare Workers:

```bash
cd Server
npx wrangler login
npx wrangler deploy
```

The default `wrangler.toml` binds the Worker to `lyrics.txw.qzz.io`.
Change the route before deploying if you use your own domain.

## Attribution And License

Beautiful Lyrics Reborn is based on the original Beautiful Lyrics project by
surfbryce. The original upstream repository did not include a license file at
the time this reborn work was prepared, so original upstream code remains
attributed to its original author.

New reborn changes, including the Worker server in `Server/`, are released
under the GNU Affero General Public License v3.0 or later. See `LICENSE` and
`NOTICE.md`.

The fullscreen visualizers are adapted from Folia by chthollyphile and its
contributors, under AGPL-3.0. The upstream revision, preserved license and
integration boundaries are documented in `Extension/Folia/README.md` and
`Extension/Folia/vendor/provenance.json`.

The NetEase and Musixmatch provider adaptations credit Spicetify's
[lyrics-plus](https://github.com/spicetify/cli/tree/main/CustomApps/lyrics-plus).
Their upstream LGPL-2.1 terms and provenance are preserved in `NOTICE.md` and
`LICENSES/Spicetify-LGPL-2.1.txt`.

The KuGou provider and KRC decoder/parser credit
[lrcmux](https://github.com/f1nniboy/lrcmux) by f1nniboy. Its MIT copyright and
permission notice are preserved in `LICENSES/lrcmux-MIT.txt`; see `NOTICE.md`
for the upstream revision and adapted files.

## Extension Releases And Updates

The Marketplace entry is a small, stable loader. `cd Extension && deno task release`
creates a SHA-256-named payload, `latest.json`, and the loader. The manifest entry
path stays unchanged so Marketplace continues to recognize existing installs.

The loader checks `https://lyrics.txw.qzz.io/extension/latest.json` at startup
without caching and checks for updates every five minutes. It downloads each
payload concurrently from the Worker and `https://lyrics.20050129.xyz/extension/`,
uses the first complete download that passes the full SHA-256 check, and cancels
the other request. If both routes fail, it tries jsDelivr, then the last successfully
loaded release and the loader's embedded release. It prompts for a Spotify reload
instead of executing two releases in the same session. Existing installs need to
refresh the loader once to enable the domestic route. This is a network fallback, not a
guarantee of offline operation. Local development installs remain offline bundles.

Publishing also requires deploying the Worker and its release assets together.
See [the publishing guide](docs/spicetify-marketplace-publishing.md) for CI secrets,
first-time migration, verification, and rollback.
