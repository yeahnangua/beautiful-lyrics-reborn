/** Serve assets from the same Worker deployment, never a mutable GitHub/CDN URL. */
export async function extensionReleaseResponse(request: Request, assets?: Fetcher): Promise<Response> {
  const url = new URL(request.url);
  const file = url.pathname.slice("/extension/".length);
  const latest = file === "latest.json";
  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "CDN-Cache-Control": "no-store",
  });
  if (!latest && !/^beautiful-lyrics-reborn\.[a-f0-9]{16}\.mjs$/.test(file)) {
    return new Response("Not found", { status: 404, headers });
  }
  if (!assets) return new Response("Releases not configured", { status: 503, headers });
  url.pathname = `/${file}`;
  url.search = "";
  // Do not forward conditional headers: latest must always be the current pointer.
  let response: Response;
  try {
    response = await assets.fetch(new Request(url, { method: "GET" }));
  } catch {
    return new Response("Release unavailable", { status: 503, headers });
  }
  if (!response.ok) return new Response("Release unavailable", { status: 503, headers });
  headers.set("Content-Type", latest ? "application/json; charset=utf-8" : "text/javascript; charset=utf-8");
  if (!latest) {
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("CDN-Cache-Control", "public, max-age=31536000, immutable");
  }
  return new Response(response.body, { headers });
}
