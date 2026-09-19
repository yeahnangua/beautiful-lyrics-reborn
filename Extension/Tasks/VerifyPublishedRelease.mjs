// Run from any directory after deploying; an optional origin supports local smoke tests.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const base = new URL("/extension/", process.argv[2] ?? "https://lyrics.txw.qzz.io");
const expected = JSON.parse(await readFile(new URL("../Builds/Release/latest.json", import.meta.url), "utf8"));
const pointer = await fetch(new URL("latest.json", base), { cache: "no-store", signal: AbortSignal.timeout(20000) });
assert.equal(pointer.status, 200, "Update endpoint must return 200");
assert.equal(pointer.headers.get("cache-control"), "no-store");
assert.equal(pointer.headers.get("access-control-allow-origin"), "*");
assert.deepEqual(await pointer.json(), expected, "Live pointer must match this build");
const payload = await fetch(new URL(expected.file, base), { signal: AbortSignal.timeout(30000) });
assert.equal(payload.status, 200);
assert.match(payload.headers.get("content-type"), /javascript/);
assert.match(payload.headers.get("cache-control"), /immutable/);
assert.equal(createHash("sha256").update(Buffer.from(await payload.arrayBuffer())).digest("hex"), expected.sha256);
console.log(`Verified published release ${expected.version} (${expected.sha256.slice(0, 16)})`);
