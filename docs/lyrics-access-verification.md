# Lyrics authentication verification — 2026-11-06

Version 5.3.0 was published through the normal release workflow on 2026-11-06 at
19:03 China time. Production verifies Spotify credentials through the desktop
lyrics service and immediately requires signed sessions for every lyrics request.
Real-client, production and release-asset checks passed.

## Completed checks

| Check | Result |
| --- | --- |
| Worker tests, including actual workerd authentication and native quotas | 401 passed |
| Extension runtime, loader, session and cancellation tests | 90 passed |
| Folia browser UI tests, unchanged by the authentication revision | 34 passed |
| Server TypeScript, extension Deno and Folia TypeScript checks | Passed |
| Extension release build with Deno 2 and Node.js 24 | 5.3.0 built |
| Wrangler deployment dry run with all three authentication limiters | Passed |
| Public update manifest, main bundle and fullscreen bundle | HTTP 200; both SHA-256 hashes match the published manifest |
| Production session and authenticated lyrics request from the real Spotify renderer | Both HTTP 200 |
| Anonymous, missing-session, forged-session and token-mismatch requests | All HTTP 401 with stable error codes and no-store headers |
| Updated Mac plugin and existing local lyrics cache | 5.3.0 loaded; provider and transformed caches remain valid |

Git was initially fast-forwarded to `b96b611` and, after release, to the generated
bundle commit `7018dff`. The original uncommitted changes to
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
The temporary Worker used a separate hostname, secret and rate-limit namespaces,
with no production route or database bindings. It and its hostname and secret
were removed after compatibility validation.

At 19:05 China time, the production session endpoint returned 200 using the real
desktop bearer. The protected lyrics endpoint returned line lyrics from Spotify
with HTTP 200 and no-store headers. A repeated authorized request returned 200
with the same lyrics hash. Requests for the same track without credentials,
without a session, with a forged session, and with a mismatched bearer all
returned 401. Their error codes were `missing_spotify_token` or `invalid_session`.

The Mac loader fetched the public manifest without credentials and loaded 5.3.0.
The current track's provider and transformed lyric caches remained present,
unexpired and at cache version 11. Playback remained paused during these checks;
playback, preloading, source filtering and cancellation are also covered by the
automated test suites above.

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

The independent production `LYRICS_SESSION_SECRET` and the
`LYRICS_AUTH_COMPATIBILITY_VERIFIED=true` deployment acknowledgement were configured
after real-client compatibility passed. The
[release workflow](https://github.com/yeahnangua/beautiful-lyrics-reborn/actions/runs/42205876673)
completed successfully, including the tests, compatibility gate, generated-bundle
commit, Worker/assets deployment and published-release verification. Implementation
commits are `0db0663` and `44fd291`; the published bundle commit is `7018dff`.

The public manifest identifies:

| Asset | SHA-256 |
| --- | --- |
| Main bundle | `f834b9c58575e583dc0efc74094deb6016ccdbafb8aadcc3013176c50692df73` |
| Fullscreen bundle | `8ed9f7eda0a50dbb877e27dc7e9ccb7b74574b34c3077b28a409fe864d72b469` |

Production settings were read back to verify all three native limiter bindings
and the signing-secret binding. Application logs are enabled; automatic invocation
logs are disabled so request-detail events do not retain the lyrics session header.

The temporary validation Worker, custom hostname and secret have been deleted.
The Mac was returned to a normal running Spotify process, with port 9222 confirmed
closed. Spicetify is 2.46.4, and the original theme, color scheme, extension list
and custom-app settings still match the backup.

Old plugin versions must reload or update to use the enforced protocol. A client
with a valid, lyrics-capable Spotify credential can still imitate the public
plugin protocol; this does not prove that a request came from official plugin code.

See [the protocol and release instructions](lyrics-access.md).
