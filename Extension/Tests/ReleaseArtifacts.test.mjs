import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

test("published pointer, payload digest, fallback and stable Marketplace identity agree", async () => {
  const directory = new URL("../Builds/Release/", import.meta.url);
  const descriptor = JSON.parse(await readFile(new URL("latest.json", directory), "utf8"));
  const payload = await readFile(new URL(descriptor.file, directory));
  assert.equal(createHash("sha256").update(payload).digest("hex"), descriptor.sha256);
  assert.equal(descriptor.file, `beautiful-lyrics-reborn.${descriptor.sha256.slice(0, 16)}.mjs`);
  if (descriptor.fullscreen) {
    const runtime = await readFile(new URL(descriptor.fullscreen.file, directory));
    assert.equal(createHash('sha256').update(runtime).digest('hex'),descriptor.fullscreen.sha256);
    assert.ok([1,2].includes(descriptor.fullscreen.api));
    const main = payload.toString('utf8');
    assert.doesNotMatch(main,/Folia visualizers|react\.production|pixi\.js|data:image\/png/);
    assert.ok(main.includes(descriptor.fullscreen.sha256));
  }
  const loader = await readFile(new URL("beautiful-lyrics-reborn.mjs", directory), "utf8");
  const template = await readFile(new URL("../Spices/AutoUpdate/ReleaseLoader.mjs", import.meta.url), "utf8");
  const build = JSON.parse(await readFile(new URL('../build.json',import.meta.url),'utf8'));
  if (descriptor.version === build.Version) assert.equal(loader.replaceAll("\r\n", "\n"), `${template}\nawait startReleaseLoader(${JSON.stringify(descriptor)});\n`.replaceAll("\r\n", "\n"));
  else assert.ok(loader.includes(`await startReleaseLoader(${JSON.stringify(descriptor)});`),'An unpublished source change keeps the last published pointer and loader paired');
  const manifest = JSON.parse(await readFile(new URL("../../manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.main, "Extension/Builds/Release/beautiful-lyrics-reborn.mjs");
});

// Historical payloads remain available for rollback; inspect only the current release.
test("current payload has no transliteration controls, engines or dictionary requests", async () => {
  const directory = new URL("../Builds/Release/", import.meta.url);
  const descriptor = JSON.parse(await readFile(new URL("latest.json", directory), "utf8"));
  const payload = await readFile(new URL(descriptor.file, directory), "utf8");
  assert.doesNotMatch(payload, /RomanizedText|Romanization|ToggleRoman|kuromoji|kuroshiro|aromanize|pinyin|dict-zi|phrases-dict/i);
  if(descriptor.fullscreen)assert.doesNotMatch(await readFile(new URL(descriptor.fullscreen.file,directory),'utf8'), /RomanizedText|Romanization|ToggleRoman|kuromoji|kuroshiro|aromanize|pinyin|dict-zi|phrases-dict/i);
});
