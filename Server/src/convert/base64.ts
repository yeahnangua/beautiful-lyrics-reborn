/** Upstream LRC payloads are base64-encoded UTF-8, not Latin-1 strings. */
export function decodeBase64Text(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return undefined;
  }
}
