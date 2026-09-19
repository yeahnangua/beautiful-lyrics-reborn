// Run from any directory after deploying; an optional origin supports local smoke tests.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const base = new URL("/extension/", process.argv[2] ?? "https://lyrics.txw.qzz.io");
const expected = JSON.parse(await readFile(new URL("../Builds/Release/latest.json", import.meta.url), "utf8"));
async function verify() {
  const pointer = await fetch(new URL("latest.json", base), { cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (pointer.status !== 200) {
    const detail = (await pointer.text()).slice(0, 300).replace(/\s+/g, " ");
    throw new Error(`Update endpoint HTTP ${pointer.status}; cf-ray=${pointer.headers.get("cf-ray")}; cf-mitigated=${pointer.headers.get("cf-mitigated")}; ${detail}`);
  }
  assert.equal(pointer.headers.get("cache-control"), "no-store");
  assert.equal(pointer.headers.get("access-control-allow-origin"), "*");
  assert.deepEqual(await pointer.json(), expected, "Live pointer must match this build");
  const payload = await fetch(new URL(expected.file, base), { signal: AbortSignal.timeout(30000) });
  assert.equal(payload.status, 200);
  assert.match(payload.headers.get("content-type"), /javascript/);
  assert.match(payload.headers.get("cache-control"), /immutable/);
  assert.equal(createHash("sha256").update(Buffer.from(await payload.arrayBuffer())).digest("hex"), expected.sha256);
  console.log(`Verified published release ${expected.version} (${expected.sha256.slice(0, 16)})`);
}

// Allow a short deployment propagation window, but never accept a stale release.
for (let attempt = 1; attempt <= 4; attempt++) {
  try {
    await verify();
    break;
  } catch (error) {
    if (attempt === 4) throw error;
    console.warn(`Verification attempt ${attempt} failed: ${error.message}`);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}
