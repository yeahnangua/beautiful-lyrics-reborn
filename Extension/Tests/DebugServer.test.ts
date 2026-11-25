/// <reference lib="deno.ns" />
import { ReadTestAsset } from "../Spices/Debug/ServeTest.ts"

Deno.test("debug server requires a session and serves only contained build artifacts", async () => {
  const directory = await Deno.makeTempDir({ prefix: "lyrics-debug-test-" })
  try {
    await Deno.writeTextFile(`${directory}/bundle@1.mjs`, "export default 1")
    const request = (path: string) => new Request("http://127.0.0.1:3001" + path)
    if ((await ReadTestAsset(request("/bundle@1.mjs"), directory, "secret")).status !== 403) throw Error("Missing token allowed")
    const valid = await ReadTestAsset(request("/bundle@1.mjs?session=secret"), directory, "secret")
    if (valid.status !== 200 || await valid.text() !== "export default 1") throw Error("Asset unavailable")
    for (const path of ["/../.dev.vars", "/..%5c..%5cServer%5c.dev.vars", "/bundle@1.mjs/../.dev.vars", "/other.txt"]) {
      if ((await ReadTestAsset(request(path + "?session=secret"), directory, "secret")).status !== 404) throw Error("Unexpected asset accepted")
    }
  } finally {
    // The test owns this freshly-created temporary directory.
    await Deno.remove(directory, { recursive: true })
  }
})
