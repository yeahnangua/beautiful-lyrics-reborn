import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { PluginFetch, UserAgent, WithUserAgent } from "../../Universal/Modules/Http.ts";

test("HTTP requests carry the plugin identity and preserve request headers and bodies", async () => {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ headers: request.headers, body });
    response.end("ok");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/lyrics`;
  try {
    await (await PluginFetch(url)).text();
    const headers = { Authorization: "Bearer test", "User-Agent": "Mozilla/5.0" };
    await (await PluginFetch(new URL(url), { method: "POST", body: "feedback", headers })).text();
    await (await PluginFetch(new Request(url, { headers: { Authorization: "Bearer request" } }))).text();
    await (await PluginFetch(new Request(url, { headers: { Authorization: "replaced" } }), {
      headers: [["X-Test", "override"], ["user-agent", UserAgent]],
    })).text();
    assert.deepEqual(requests.map(request => request.headers["user-agent"]), [
      UserAgent, `Mozilla/5.0 ${UserAgent}`, UserAgent, UserAgent,
    ]);
    assert.equal(requests[1].headers.authorization, "Bearer test");
    assert.equal(requests[1].body, "feedback");
    assert.equal(requests[2].headers.authorization, "Bearer request");
    assert.equal(requests[3].headers.authorization, undefined);
    assert.equal(requests[3].headers["x-test"], "override");
    assert.equal(headers["User-Agent"], "Mozilla/5.0");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("provider compatibility UAs survive header normalization without duplicate plugin identities", () => {
  for (const input of [
    { "user-agent": "Mozilla/5.0", Accept: "application/json" },
    new Headers({ "User-Agent": "Mozilla/5.0", Accept: "application/json" }),
    [["User-Agent", "Mozilla/5.0"], ["Accept", "application/json"]],
  ]) {
    const headers = new Headers(WithUserAgent(input));
    assert.equal(headers.get("User-Agent"), `Mozilla/5.0 ${UserAgent}`);
    assert.equal(headers.get("Accept"), "application/json");
    assert.deepEqual(WithUserAgent(WithUserAgent(input)), WithUserAgent(input));
    assert.equal(new Headers(input).get("User-Agent"), "Mozilla/5.0");
  }
});
