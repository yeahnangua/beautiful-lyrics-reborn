# Publishing To Spicetify Marketplace

The repository must be public, have the `spicetify-extensions` GitHub topic, and
contain a root `manifest.json`. Keep its `main` value stable:

```json
{
  "main": "Extension/Builds/Release/beautiful-lyrics-reborn.mjs"
}
```

Marketplace includes `manifest.main` in the installed extension identity. Do not
change this path for each release. The file is now a small loader, not the payload.

## Build and publication

Version 5.4 uses a two-stage publication through `Extension/Tasks/PublishRelease.mjs`.
`PrepareRelease.mjs` restores the last published immutable files from the `releases`
branch before building. CI builds once, verifies locally, deploys the new server and
assets while retaining the previous pointer, and verifies the new hashes on
workers.dev and both public domains. It then publishes immutable files to `releases`,
verifies jsDelivr, deploys the new pointer, verifies again, and updates the release
branch pointer and stable Marketplace entry. Failed promotion restores the previous
pointer while retaining the compatible new server. Main advancement aborts a stale
publication; no history rewriting or force push is used.

New payloads use `/Release/` static routes and `@releases` for jsDelivr. Both the
main loader and fullscreen loader verify Cache Storage bytes before reuse, retain
three bundles, and tolerate restricted storage. Pointer fallback tries the domestic
domain and release-branch CDN before the legacy Worker route. Old `/extension/`
paths and the last existing main-branch bundles remain available for old loaders.
The stable loader is publicly served with `no-store`; hashed payloads are immutable.

Fullscreen API 2 carries optional auxiliary resource descriptors; API 1 remains
accepted. Pruning retains the current and two previous complete releases, including
their fullscreen and Nebbia resources. Build output is still generated locally
under `Extension/Builds/Release`; only the publication job sends large new files to
the independent branch. A branch in the same repository does not shrink historical
Git objects.

Run `deno task release` from `Extension/`. It generates:

- `beautiful-lyrics-reborn.<first 16 SHA-256 hex characters>.mjs`: self-contained
  code and styles, with immutable content. The loader checks all 64 hash digits.
- `latest.json`: schema version, display version, complete SHA-256, and filename.
- `beautiful-lyrics-reborn.mjs`: stable loader with a fallback release descriptor.

The hash is computed from the final bundle bytes, not a Git commit ID. Existing
hashed files are retained for old loaders and rollback. Do not edit them in place.
Bump `Extension/build.json` for a user-visible version; content hashes still detect
changes if a version bump is accidentally omitted.

The GitHub workflow builds and tests once, then runs the staged publication described above. Configure
these repository Actions secrets before enabling publication:

- `CLOUDFLARE_API_TOKEN`: scoped to deploying this Worker and its assets.
- `CLOUDFLARE_ACCOUNT_ID`: the account owning `lyrics.txw.qzz.io`.

Without these secrets publication fails explicitly; a GitHub build alone does not
advance the live update pointer. Pull requests only build and test. Manual workflow
dispatch can retry publication on `main`. The deployment includes the lyrics Worker
code as well as release assets, so the workflow runs the Worker tests and typecheck.

For a manual deployment after building, run `npm ci` and `node Tasks/Deploy.mjs` from
`Server/`. The existing Worker route and Analytics Engine binding are preserved.
The update pointer and payloads are uploaded as part of one Worker version, avoiding
a pointer that advertises an asset from an unfinished upload.

## Runtime behavior

The loader fetches `https://lyrics.txw.qzz.io/Release/latest.json` on startup
with `cache: "no-store"`. Version checks prefer this static origin and use the domestic/CDN fallbacks when unavailable.
This path is excluded from `run_worker_first`, so Cloudflare static assets answer it
without invoking (or billing) the Worker; its headers come from `Extension/Builds/_headers`.
Static assets only answer GET/HEAD, so the request must not carry custom headers that
would need a CORS preflight. If it fails, the loader falls back to
`/extension/latest.json`, the Worker route that older loaders still use.
The Worker reads the pointer from its current asset binding (not GitHub or jsDelivr)
and returns `Cache-Control: no-store` and `CDN-Cache-Control: no-store`. Do not add a
Cloudflare cache rule that overrides these headers on `/extension/latest.json`.
Hashed payloads receive a one-year immutable cache policy and CORS headers.

For each release, the loader starts two payload downloads together:
`https://lyrics.txw.qzz.io/Release/` and
`https://lyrics.20050129.xyz/Release/`. The first complete payload whose full
SHA-256 matches the selected release wins, and the other request is aborted.
Each attempt has a 60-second deadline covering the response body and verification.
Only when both routes fail does the loader try the same hash on jsDelivr, then
the previous successful release and the embedded fallback.

The domestic domain uses Alibaba Cloud acceleration with `lyrics.txw.qzz.io`
as its origin. Configure HTTPS origin fetch with both Host and SNI set to
`lyrics.txw.qzz.io`, and a valid certificate for `lyrics.20050129.xyz` on the
Alibaba edge. Hashed payloads should keep their one-year immutable cache policy
and `Access-Control-Allow-Origin: *`; `latest.json` must remain uncached.
Disable content transformations that would change the payload's SHA-256.
DNS must point the download domain to the acceleration service's assigned CNAME;
an ordinary CNAME directly to the Worker alone does not add Alibaba acceleration.
This uses the existing Worker assets, without R2 uploads or extra release steps.

The loader verifies payload bytes before importing a JavaScript Blob. Keep Spotify's
normal Blob module support available; this must be smoke-tested in supported Spotify
clients. It never evaluates a second payload after module evaluation has started.
A global guard also prevents two copies of the loader starting simultaneously.

Cached metadata cannot change the payload origins or bypass the SHA-256 check.
Verified Cache Storage payloads can be reused when the network is unavailable. A separately built offline extension also embeds the fullscreen runtime and auxiliary resources.

Every five minutes it checks for a changed hash (including a rollback), and shows
one reload notification per detected hash. It does not hot-swap active code. The
console reports the actual version and build hash. You can also inspect:

```js
globalThis.__beautifulLyricsRebornLoader
```

## First migration

Old full bundles cannot update themselves into loaders. Existing users need to
obtain the loader once. Marketplace's cached entry may require a CDN purge and
reload, or manual installation of the stable loader from a verified GitHub commit.
Uninstall the Marketplace copy before enabling a manual copy to avoid duplicates.
The former offline bundle has no loader guard, so do not leave both installed.
Subsequent payload releases do not require another Marketplace reinstall.

Users who already have an older loader must also refresh or reinstall the stable
Marketplace entry once to enable the domestic download race. Payload updates do
not replace an installed loader.

## Verify and roll back

After deployment, run `node Extension/Tasks/VerifyPublishedRelease.mjs` from the
repository root (CI also runs it). Check `/extension/latest.json`: it must return the intended hash
and `no-store`. Download the referenced `/extension/<file>` and compare its SHA-256.
Reload Spotify and confirm the console build hash, buttons, and lyric views on both
Windows and macOS. Test a second release with the *old* loader still installed.

For rollback, restore a previous `latest.json` whose payload remains in the release
directory, and deploy the Worker assets without rebuilding the extension (a rebuild
would replace that pointer). Alternatively roll back the whole Worker deployment,
which also rolls back the lyrics server. The next check prompts a reload to the
previous payload. Keep older immutable files when publishing subsequent releases.
## Fullscreen runtime assets

Online releases now include a pinned `fullscreen` descriptor in `latest.json` and a separate `beautiful-lyrics-reborn-fullscreen.<hash>.mjs`. Publish and verify both payloads together; keep the runtime referenced by each retained main release. Existing schema-1 loaders remain compatible. The updated Worker also accepts `/metrics` and uses the independent `lyrics_metrics` dataset and `METRICS_LIMITER` binding. Details and deployment order: [fullscreen loading and statistics](fullscreen-loading-and-statistics.md).
