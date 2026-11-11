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
The Worker inserts the credit text as the final ordinary lyric before returning
JSON: a `Vocal` entry in `Content`, or a text entry in static `Lines`. The entry
is marked `IsAttribution` so clients can preserve contributor links without
adding a second footer. Timed entries run from `duration - 0.1` to `duration`,
using the exact song duration in seconds, rather than the last sung lyric's end.
If no valid duration is available, the existing lyrics end time is used.
Static lyrics retain their untimed format.

Card and page views use the normal lyric font, alignment, gradient, blur and
scrolling. Contributor links are inline and do not seek playback when clicked.
Folia visualizers consume the same final lyric; canvas modes retain community
profile links in the control capsule, without repeating the provider caption.
Contributor links accept only HTTP(S) URLs.

The final row is projected after reading the server cache, so old cached Spicy
results gain the row immediately and repeated responses never accumulate rows.
The stored provider payload and content fingerprint exclude this generated row.
Client cache version 11 refreshes responses created before this change.

## Server cache

Lyrics use Workers Cache on the private `LyricsOrigin` entrypoint. The public
entrypoint authenticates every request and reads source policy before accessing
the cache. `FEEDBACK_DB` retains source rules, feedback and diagnostics; there is
no lyrics D1 binding or migration. `node Tasks/Deploy.mjs` applies only feedback
migrations before deploying. See [lyrics-cache.md](lyrics-cache.md).

Ordinary deployments share cached content. Changes affecting content or source
selection require an explicit `lyricsCacheVersion` bump. Requests retain their
quality preference, but CDN fills do not provide the former D1 atomic comparison
between concurrent results. `LYRICS_CACHE_MODE=off` bypasses caching while retaining
authentication and mandatory source policy checks.
