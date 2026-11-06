# Lyrics authentication verification — 2026-11-06

The implementation now verifies Spotify credentials through the desktop lyrics
service. Real-client and Cloudflare checks passed. Publication through the normal
release workflow is the remaining step; production is still 5.2.3 at this check.

## Completed checks

| Check | Result |
| --- | --- |
| Worker tests, including actual workerd authentication and native quotas | 401 passed |
| Extension runtime, loader, session and cancellation tests | 90 passed |
| Folia browser UI tests, unchanged by the authentication revision | 34 passed |
| Server TypeScript, extension Deno and Folia TypeScript checks | Passed |
| Extension release build with Deno 2 and Node.js 24 | 5.3.0 built |
| Wrangler deployment dry run with all three authentication limiters | Passed |
| Existing public update manifest and referenced bundle | Both returned HTTP 200 |

Git was fast-forwarded to `b96b611`. The original uncommitted changes to
`Server/src/extension-release.ts` and `Server/test/extension-release.test.ts`
still match their saved patch exactly and are excluded from this change.

## Real-client validation

The supplied Mac runs Spicetify 2.46.4. After Spotify updated to 1.3.8.620, its
patch was reapplied using `spicetify backup apply --no-restart`, preserving the
theme and extension configuration. Credentials were read from the running
desktop client only into verification-process memory. No token, cookie, profile
value or lyric text was printed or written to a file.

For `color-lyrics/v2/track/6OsRo5kez17uDLwddaKfrI`, the existing bearer with the
client's actual `OSX_ARM64` platform and version returned HTTP 200 and 57 lyric
lines. A forged bearer and an unauthenticated request each returned 401. Using
the guessed `WebPlayer` platform instead returned 403 for the real bearer, so the
extension now forwards its actual platform and version when obtaining a session.

An isolated Cloudflare Worker running the actual authentication implementation
also received Spotify 200, with an observed upstream duration of 88 milliseconds,
and issued a signed lyrics session. Forged credentials received 401; missing
credentials received 401 without any upstream request.

At 18:32 China time, the real Spotify renderer completed the browser flow:
session issuance 200, protected verification request 200, forged session 401,
599 seconds of session lifetime remaining, and no-store response headers.
The temporary Worker uses a separate hostname, secret and rate-limit namespaces;
it has no production route or database bindings.

## Authentication decision

The user approved token/IP quotas because the lyrics endpoint does not return
an account identifier. The implementation enforces 60 session exchanges per IP
per minute, 60 lyric requests per Spotify token per minute, and 300 lyric requests
per IP per minute. Tests verify that session renewal preserves the token quota
and changing tokens preserves the IP quota.

The earlier `/v1/me` approach was abandoned after both direct desktop and
Cloudflare requests repeatedly received Spotify 429. It is no longer used for
authentication. The website profile endpoint was also investigated: the user's
complete website-cookie request returned 200, and a request containing only its
`sp_dc` cookie still returned 200 without CSRF headers. Cookie-free bearer
requests returned 400. Website cookies are not part of the chosen protocol.

## Publishing and cleanup

Before publishing, configure the independent production `LYRICS_SESSION_SECRET`
and the `LYRICS_AUTH_COMPATIBILITY_VERIFIED=true` deployment acknowledgement, then
run the existing release workflow. After publication, verify the public update
assets, anonymous rejection and lyrics loading in the updated plugin. Remove
the temporary verification Worker, hostname and secret, and restore the Mac's
normal Spotify process with its loopback debugging port closed.

See [the protocol and release instructions](lyrics-access.md).
