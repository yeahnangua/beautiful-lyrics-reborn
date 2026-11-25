/** Public metadata is untrusted, including when the lyrics session is valid. */
export function validateLyricsInput(request: Request, url: URL): void {
  const limits: Record<string, number> = { track_name: 500, album_name: 500, artist_name: 300,
    apple_title: 500, apple_id: 24, isrc: 12, duration: 24, lookup: 16 };
  let bytes = 0;
  const counts = new Map<string, number>();
  for (const [key, value] of url.searchParams) {
    bytes += new TextEncoder().encode(key + value).length;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    if (count > (key === "artist_name" ? 30 : 1) || value.length > (limits[key] ?? 500)) throw Error("Invalid metadata");
  }
  if (bytes > 12_000 || [...counts.values()].reduce((a, b) => a + b, 0) > 48) throw Error("Metadata too large");
  for (const [name, pattern] of [
    ["X-Spotify-App-Platform", /^[a-z0-9_-]{1,64}$/i],
    ["X-Spotify-App-Version", /^[a-z0-9._+-]{1,64}$/i],
  ] as const) {
    const value = request.headers.get(name);
    if (value !== null && !pattern.test(value)) throw Error("Invalid Spotify client");
  }
  const isrc = url.searchParams.get("isrc");
  if (isrc && !/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(isrc)) throw Error("Invalid ISRC");
  const apple = url.searchParams.get("apple_id");
  if (apple && !/^\d{1,24}$/.test(apple)) throw Error("Invalid Apple Music ID");
  const duration = url.searchParams.get("duration");
  if (duration && (!Number.isFinite(Number(duration)) || Number(duration) <= 0 || Number(duration) > 86400)) throw Error("Invalid duration");
  if (url.searchParams.has("lookup") && url.searchParams.get("lookup") !== "apple") throw Error("Invalid lookup");
}

/** One /64 allowance for IPv6 privacy addresses; mapped IPv4 shares the IPv4 key. */
export function clientNetwork(request: Request): string {
  const raw = request.headers.get("CF-Connecting-IP")?.trim().toLowerCase();
  if (!raw) return "local";
  const ipv4 = (s: string) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(s) && s.split(".").every(n => Number(n) <= 255);
  if (ipv4(raw)) return raw.split(".").map(Number).join(".");
  let address = raw;
  if (address.includes(".")) {
    const at = address.lastIndexOf(":");
    const tail = address.slice(at + 1);
    if (!ipv4(tail)) return "invalid";
    const octets = tail.split(".").map(Number);
    address = address.slice(0, at + 1) + ((octets[0]! << 8) | octets[1]!).toString(16) + ":" + ((octets[2]! << 8) | octets[3]!).toString(16);
  }
  if (!/^[\da-f:]+$/.test(address) || address.split("::").length > 2) return "invalid";
  const [head, tail] = address.split("::");
  const left = head ? head.split(":") : [], right = tail ? tail.split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((tail === undefined && missing !== 0) || (tail !== undefined && missing < 1)) return "invalid";
  const parts = [...left, ...Array(tail === undefined ? 0 : missing).fill("0"), ...right];
  if (parts.length !== 8 || parts.some(p => !/^[\da-f]{1,4}$/.test(p))) return "invalid";
  const words = parts.map(p => Number.parseInt(p, 16));
  if (words.slice(0, 5).every(n => n === 0) && words[5] === 0xffff) {
    return [words[6]! >> 8, words[6]! & 255, words[7]! >> 8, words[7]! & 255].join(".");
  }
  return words.slice(0, 4).map(n => n.toString(16).padStart(4, "0")).join(":") + "::/64";
}

export async function readBoundedBody(response: Response, limit = 2 * 1024 * 1024, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const cancel = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    signal?.throwIfAborted();
    if (Number(response.headers.get("Content-Length")) > limit) throw Error("Upstream body too large");
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw Error("Upstream body too large");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  } finally { signal?.removeEventListener("abort", cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
