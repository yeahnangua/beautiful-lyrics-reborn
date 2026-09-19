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

Run `deno task release` from `Extension/`. It generates:

- `beautiful-lyrics-reborn.<first 16 SHA-256 hex characters>.mjs`: self-contained
  code and styles, with immutable content. The loader checks all 64 hash digits.
- `latest.json`: schema version, display version, complete SHA-256, and filename.
- `beautiful-lyrics-reborn.mjs`: stable loader with a fallback release descriptor.

The hash is computed from the final bundle bytes, not a Git commit ID. Existing
hashed files are retained for old loaders and rollback. Do not edit them in place.
Bump `Extension/build.json` for a user-visible version; content hashes still detect
changes if a version bump is accidentally omitted.

The GitHub workflow builds, tests, and commits all release files, then deploys the
Worker with the entire release directory through Workers Static Assets. Configure
these repository Actions secrets before enabling publication:

- `CLOUDFLARE_API_TOKEN`: scoped to deploying this Worker and its assets.
- `CLOUDFLARE_ACCOUNT_ID`: the account owning `lyrics.txw.qzz.io`.

Without these secrets publication fails explicitly; a GitHub build alone does not
advance the live update pointer. Pull requests only build and test. Manual workflow
dispatch can retry publication on `main`. The deployment includes the lyrics Worker
code as well as release assets, so the workflow runs the Worker tests and typecheck.

For a manual deployment after building, run `npm ci` and `npx wrangler deploy` from
`Server/`. The existing Worker route and Analytics Engine binding are preserved.
The update pointer and payloads are uploaded as part of one Worker version, avoiding
a pointer that advertises an asset from an unfinished upload.

## Runtime behavior

The loader fetches `/extension/latest.json` on startup with `cache: "no-store"`.
The Worker reads the pointer from its current asset binding (not GitHub or jsDelivr)
and returns `Cache-Control: no-store` and `CDN-Cache-Control: no-store`. Do not add a
Cloudflare cache rule that overrides these headers on `/extension/latest.json`.
Hashed payloads receive a one-year immutable cache policy and CORS headers.

The loader verifies payload bytes before importing a JavaScript Blob. Keep Spotify's
normal Blob module support available; this must be smoke-tested in supported Spotify
clients. It never evaluates a second payload after module evaluation has started.
A global guard also prevents two copies of the loader starting simultaneously.

If a download fails, the loader tries the same hash on jsDelivr, then the previous
successful release and the embedded fallback. Cached metadata cannot change the
payload origin or bypass the SHA-256 check. Fallbacks still require reachable or
browser-cached payload bytes; this is not an offline installation.

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
