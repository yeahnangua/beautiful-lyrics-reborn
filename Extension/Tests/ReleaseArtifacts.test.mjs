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
  const loader = await readFile(new URL("beautiful-lyrics-reborn.mjs", directory), "utf8");
  const template = await readFile(new URL("../Spices/AutoUpdate/ReleaseLoader.mjs", import.meta.url), "utf8");
  assert.equal(loader, `${template}\nawait startReleaseLoader(${JSON.stringify(descriptor)});\n`);
  const manifest = JSON.parse(await readFile(new URL("../../manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.main, "Extension/Builds/Release/beautiful-lyrics-reborn.mjs");
});
