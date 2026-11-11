import type { RequestDiagnostics } from "./types";

type PackedOrigin = { encoding: "gzip-base64"; data: string };

/** Keep full diagnostics while avoiding a second large plaintext request row. */
export async function packOrigin(record: RequestDiagnostics): Promise<string> {
  const stream = new Blob([JSON.stringify(record)]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  const packed: PackedOrigin = { encoding: "gzip-base64",
    data: btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join("")) };
  return JSON.stringify(packed);
}

export async function unpackOrigin(value: unknown): Promise<RequestDiagnostics> {
  if (!value || typeof value !== "object") throw new Error("Invalid origin diagnostics");
  if ("encoding" in value) {
    const packed = value as PackedOrigin;
    if (packed.encoding !== "gzip-base64" || typeof packed.data !== "string") throw new Error("Invalid origin encoding");
    const bytes = Uint8Array.from(atob(packed.data), char => char.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    value = await new Response(stream).json();
  }
  const record = value as RequestDiagnostics;
  if (!record || typeof record.id !== "string" || !Array.isArray(record.attempts)) throw new Error("Invalid origin diagnostics");
  return record;
}
