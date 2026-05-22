# Publishing To Spicetify Marketplace

Spicetify Marketplace discovers extensions through GitHub repository metadata.

Required setup:

1. The repository must be public.
2. The repository must have the `spicetify-extensions` GitHub topic.
3. The repository root must contain a valid `manifest.json`.
4. The manifest `main` value must point to the built extension file.

For this repository:

```json
{
  "main": "Extension/Builds/Release/beautiful-lyrics-reborn.mjs"
}
```

Marketplace reads the manifest from the default branch and installs the raw
`main` file. Because of that, the release bundle is committed to the repository
instead of relying on the original Beautiful Lyrics auto-updater.

Useful verification URLs after pushing:

```text
https://raw.githubusercontent.com/yeahnangua/beautiful-lyrics-reborn/main/manifest.json
https://raw.githubusercontent.com/yeahnangua/beautiful-lyrics-reborn/main/Extension/Builds/Release/beautiful-lyrics-reborn.mjs
```
