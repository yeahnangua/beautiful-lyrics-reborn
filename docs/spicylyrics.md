# Spicy Lyrics provider

The server integrates [Spicy Lyrics](https://developers.spicylyrics.org/) as a
high-priority lyrics source. It is keyed directly by Spotify track ID, so one
request returns the best available sync (community, then Apple Music, then
Spotify, preferring word-level timing).

## How it is wired in

- **Endpoint:** `GET https://api.spicylyrics.org/v1/lyrics/{spotifyId}`, authenticated with `Authorization: Bearer <key>`.
- **Placement:** first candidate in the syllable phase, so it competes for the
  preferred word-level result. The service resolves the first qualifying result,
  and Spicy's single keyed request is usually the fastest syllable source.
- **Fallback:** a Spicy `Line` result is kept for the line phase, and a `Static`
  result is kept for the static phase (first in static order).
- **Sanitizing:** upstream-only fields (`id`, `source`, `UploadAttribution`,
  transliterations) are stripped; only the `BeautifulLyrics` shape is returned.
- **Source policy:** block it per track with provider name `spicylyrics`
  (`Syllable` / `Line` / `Static`).

## API key

The provider is skipped when no key is configured, so it is a safe no-op until a
key is added.

1. Create an application at
   <https://developers.spicylyrics.org/dashboard/applications>. For this backend
   use a **secret key** (`sl_sk_...`).
2. Set it as a Worker secret:

   ```bash
   cd Server
   npx wrangler secret put SPICY_LYRICS_KEY
   ```

   For local development you can also set `SPICY_LYRICS_KEY` in `.dev.vars`.

## Attribution (binding requirement)

Spicy Lyrics' terms require that the provider name always be shown with the
lyrics, and — when the `source` is a community sync — that the uploader and maker
be linked as well. The server preserves this information in `Attribution`.
Card and page views include a measured footer with uploader/maker links (the 🔗
and username form one link). Timed footers highlight during the final 0.1 seconds
of the lyrics and reset on seeks or offset changes. Static footers participate
in scroll sizing. Folia fullscreen/cinema displays the same provider and links
in the bottom control capsule, including while the transport controls collapse.

Contributor links open in a new tab and accept only HTTP(S) URLs.

## Server cache

Apply `Server/migrations/0005_lyrics_cache.sql` before using the D1 cache
(`npx wrangler d1 migrations apply beautiful-lyrics-feedback --remote`, using
 your configured database name). Without the migration, lyrics still resolve
from providers. Unexpired higher-quality rows cannot be overwritten by a lower
quality concurrent result; expired rows may be replaced at any quality tier.
