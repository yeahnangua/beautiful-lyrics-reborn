# Beautiful Lyrics Reborn

Beautiful Lyrics Reborn is a community-maintained revival of the original
Beautiful Lyrics Spicetify extension. It keeps the fullscreen/card/page lyric
experience alive and adds a new Cloudflare Worker lyrics service for Spotify,
AMLLDB, QQ Music, NetEase, and LRCLIB fallbacks.

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
- Reborn lyrics provider priority:
  1. AMLLDB syllable lyrics.
  2. QQ Music QRC syllable lyrics.
  3. NetEase YRC syllable lyrics.
  4. Spotify line lyrics.
  5. LRCLIB line lyrics.
  6. Spotify static lyrics.
  7. LRCLIB static lyrics.

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

## Marketplace Publishing

Spicetify Marketplace discovers public GitHub repositories by topic. To publish
this extension:

1. Push this repository to GitHub.
2. Add the `spicetify-extensions` topic to the repository.
3. Keep `manifest.json` in the repository root.
4. Keep `Extension/Builds/Release/beautiful-lyrics-reborn.mjs` committed.

Marketplace reads `manifest.json`, then installs the `main` file from the
repository. No central Marketplace pull request is needed for normal
extensions.

## Attribution And License

Beautiful Lyrics Reborn is based on the original Beautiful Lyrics project by
surfbryce. The original upstream repository did not include a license file at
the time this reborn work was prepared, so original upstream code remains
attributed to its original author.

New reborn changes, including the Worker server in `Server/`, are released
under the GNU Affero General Public License v3.0 or later. See `LICENSE` and
`NOTICE.md`.
