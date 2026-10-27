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
be linked as well. The server currently surfaces the source as
`Provider: "spicylyrics"` in the lyrics provenance, but the extension does not yet
render provider attribution. Before enabling this provider in a public build,
add a client-side attribution line that honours the upstream `source` and
`UploadAttribution` fields, otherwise the terms are not satisfied.
