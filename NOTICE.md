Beautiful Lyrics Reborn

Beautiful Lyrics Reborn is a community-maintained continuation of the original
Beautiful Lyrics Spicetify extension by surfbryce:

https://github.com/surfbryce/beautiful-lyrics

The reborn changes in this repository, including the Cloudflare Worker server
under `Server/`, are licensed under AGPL-3.0-or-later, except where noted below.

The original upstream project did not include a license file at the time this
repository was prepared. Copyright in original upstream code remains with the
original copyright holders. This notice is included to preserve attribution and
to make the licensing boundary explicit.

Third-party dependencies retain their own licenses.

Spicetify lyrics-plus provider adaptations
-----------------------------------------

The NetEase matching approach, Musixmatch request protocol, anonymous-token
refresh, and RichSync conversion were adapted with reference to Spicetify
lyrics-plus, by the Spicetify contributors:

https://github.com/spicetify/cli
Upstream revision: 8af85e5afa9dce8d6c4df1234351a07ff63abf80
Upstream files: CustomApps/lyrics-plus/ProviderNetease.js,
CustomApps/lyrics-plus/ProviderMusixmatch.js, CustomApps/lyrics-plus/Settings.js.

Affected files in this repository: Server/src/providers/netease.ts,
Server/src/providers/musixmatch.ts, Server/src/convert/richsync.ts.

Adaptations dated 2026-09-19 use TypeScript and native fetch for Cloudflare
Workers, query NetEase directly for YRC, validate lyric availability and timing,
share anonymous Musixmatch token requests, and emit Beautiful Lyrics objects.
Copyright in the upstream portions remains with the Spicetify contributors.
These adaptations retain the upstream GNU Lesser General Public License v2.1;
the complete license is included in LICENSES/Spicetify-LGPL-2.1.txt. They are
distributed without warranty. The surrounding Reborn service retains its
AGPL-3.0-or-later license.
