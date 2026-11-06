# Lyrics API access

The extension automatically exchanges its existing Spotify access token for a
ten-minute lyrics session. There is no additional sign-in, activation code, or
shared secret in the extension. Authentication is mandatory as soon as the Worker
and extension release are published. Older running extensions must reload Spotify;
offline installations must install a new bundle.

This prevents anonymous direct requests and limits bulk use. A public client can
be imitated: another application with valid Spotify user credentials can reproduce
the exchange. This is not proof of an unmodified official installation. User-Agent,
Origin, version strings, and embedded API keys are not treated as authentication.
See [RFC 8252 section 8.5](https://www.rfc-editor.org/rfc/rfc8252.html#section-8.5).

## Protocol

`POST /auth/lyrics-session` accepts `Authorization: Bearer <Spotify access token>`,
`X-Spotify-App-Platform` and `X-Spotify-App-Version`. The extension supplies its
actual desktop platform and version; these headers are compatibility metadata,
not authentication by themselves. Guessing `WebPlayer` can cause valid desktop
credentials to receive 403.

The Worker verifies the bearer against Spotify's
`GET https://spclient.wg.spotify.com/color-lyrics/v2/track/:id`, using a fixed
server-owned probe track. Only HTTP 200 with nonempty lyric lines authorizes a
session. A 404 tries one fixed fallback track; missing lyrics on both probes,
malformed responses, redirects and upstream failures do not authorize. The two
probes share a five-second deadline including response-body reads. The Worker
does not use `/v1/me`, collect website cookies, or accept a caller-selected probe.
The response is `{ token, expiresAt }`, where `expiresAt` is a Unix timestamp in
milliseconds.

`GET /lyrics/:id` requires the same Spotify bearer plus `X-Lyrics-Session: <token>`.
The session uses HMAC-SHA-256 and binds its expiry and a digest of the Spotify
token. Its signing key is independent of the administrator session secret.
Verification and token/IP rate limiting run before source-policy
queries, lyrics-cache reads, or upstream provider work. A warm cache grants no
exception. Valid sessions do not query Spotify again until renewal; Spotify
revocation may therefore take up to ten minutes to take effect.

Both routes return `Cache-Control: private, no-store`, `CDN-Cache-Control: no-store`
and `Cloudflare-CDN-Cache-Control: no-store`. Preflight is public and supports the
new header; `Retry-After` is exposed to the extension. Update assets, source policy,
statistics, reports and administrator routes retain their existing access rules.

| Status | Error code | Extension behavior |
| --- | --- | --- |
| 401 | `missing_spotify_token` | Surface the error |
| 401 | `invalid_spotify_token` | Invalidate the rejected Spotify token and obtain it again once |
| 401 | `invalid_session` | Recreate the session and retry once |
| 400 | `invalid_spotify_client` | Surface missing or invalid desktop metadata without retrying credentials |
| 403 | `spotify_forbidden` | Surface the error without retrying credentials |
| 429 | `rate_limited` | Suppress requests until `Retry-After` elapses |
| 503 | `auth_unavailable` | Fail closed; do not convert this into “no lyrics” |

The extension keeps credentials only in memory, renews thirty seconds before
expiry, and shares exchanges across current-song and prefetch requests. Cancelling
one song does not cancel another song's exchange. The existing local lyrics cache
can still be played without a network exchange.

## Limits and privacy

`LYRICS_SESSION_LIMITER` permits approximately 60 exchanges per IP per minute.
`LYRICS_TOKEN_LIMITER` permits approximately 60 lyric requests per Spotify token per
minute, across sessions and source IPs. `LYRICS_IP_LIMITER` also permits
approximately 300 lyric requests per source IP per minute, across tokens. Renewing
a session does not reset either quota; changing a Spotify token does not reset
the IP quota. Users behind the same network share that IP quota.

The lyrics probe does not return an account identifier, so this is deliberately
token/IP limiting, not account limiting. All three bindings are required and use
separate namespaces. Cloudflare applies these
[approximate limits per location](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/),
not as a globally exact quota.

Raw access/session tokens and probe lyrics are not added to logs, metrics, URLs,
or database records. Account profiles are not requested. Probe lyrics are
discarded after verification, and rate-limit keys contain only digests. The existing
`METRICS` binding records `auth:session` and `auth:lyrics` events with operation,
outcome, HTTP status, and duration, without identity dimensions. No D1 migration
is required. Automatic invocation logs are disabled so custom session headers
are not stored in request-detail events; application logs remain available.

## Publishing

1. Generate a new random 32-byte secret and configure `LYRICS_SESSION_SECRET`
   with `wrangler secret put`. Never reuse `ADMIN_SESSION_SECRET` or put the key
   in a release, repository variable, or tracked file. For local development,
   put a separate test key in ignored `Server/.dev.vars`.
2. In a real, signed-in Spicetify client, verify that an isolated Worker can
   exchange its existing token and actual client platform/version for a session
   using the Spotify lyrics probe. Also verify that missing and forged bearers
   are refused. Follow the token acquisition and `AuthorizationAPI` fallback in
   `AccessToken.ts`. Do not print or persist credentials or probe lyrics. A failed
   check stops publication; there is no anonymous or Web API fallback.
3. After that check, set the GitHub Actions repository variable
   `LYRICS_AUTH_COMPATIBILITY_VERIFIED=true`. Direct deployments require the same
   environment variable. This is a deployment acknowledgement, not a runtime
   authentication bypass.
4. Run tests, type checks, build the release, and perform `wrangler deploy --dry-run`.
   The normal workflow checks the acknowledgement, secret metadata and limiter
   bindings before publishing the release pointer. `Tasks/Deploy.mjs` repeats the
   gate before any migrations or deployment, using the installed Wrangler.
5. Publish the Worker and release assets together. Check that an anonymous lyric
   request receives 401, `/extension/latest.json` remains public, and an updated
   plugin can obtain a session and lyrics. Check both a cached and fresh lyric
   response, renewal, and existing source-policy filtering.

Missing secrets, short secrets or absent/failing limiters fail closed with 503.
Rotating the signing key invalidates outstanding sessions; the updated extension
recovers once automatically. A rollback must preserve authentication rather than
reopening the old arbitrary-bearer route. Review anonymous auth outcome counts
after release, especially 401, 403, 429 and 503 rates.
