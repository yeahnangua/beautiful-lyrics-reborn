# Beautiful Lyrics Reborn

Beautiful Lyrics Reborn is a community-maintained revival of the original
Beautiful Lyrics Spicetify extension. It keeps the fullscreen/card/page lyric
experience alive and adds a new Cloudflare Worker lyrics service for Spotify,
QQ Music, NetEase, Musixmatch, Lyrically/Paxsenix, and LRCLIB fallbacks.

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
- Romanization support for supported CJK lyrics.
- Reborn lyrics provider flow:
  1. The first available syllable lyrics from direct QQ Music QRC, NetEase YRC,
     or Musixmatch RichSync, plus Lyrically/Paxsenix Apple Music, Kugou,
     NetEase, and Deezer; syllable providers are queried concurrently.
  2. The first available line lyrics from Lyrically/Paxsenix Spotify proxy,
     Kugou, Spotify, Deezer, YouTube, or LRCLIB; Line providers are queried concurrently.
  3. Static fallbacks from Lyrically/Paxsenix Spotify proxy, Spotify,
     Deezer, YouTube, Genius, and LRCLIB.

The syllable-lyrics phase has a 20-second total time budget before the Line race starts.

The direct NetEase and Musixmatch providers do not use Paxsenix. NetEase matches
the title, artist, and duration before retrieving YRC. Musixmatch acquires and
caches an anonymous token, sends the Spotify track URI to improve matching, and
uses RichSync only when the track has word timing. A missing or restricted result
leaves the other providers available. Upstream availability and rate limits can
vary by server IP; no user credentials are bundled with these providers.

## Local Extension Install

```bash
cd Extension
printf "import { Store } from './Spices/Debug/StoreLocally.ts';\nawait Store();\n" | deno run -A -
```

This builds an offline Spicetify extension and enables
`beautiful-lyrics-reborn.mjs`.

## Server Development

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

The NetEase and Musixmatch provider adaptations credit Spicetify's
[lyrics-plus](https://github.com/spicetify/cli/tree/main/CustomApps/lyrics-plus).
Their upstream LGPL-2.1 terms and provenance are preserved in `NOTICE.md` and
`LICENSES/Spicetify-LGPL-2.1.txt`.
