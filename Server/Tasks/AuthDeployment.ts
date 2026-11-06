/** Deployment checks only; there is no runtime switch that disables authentication. */
export function assertLyricsAuthDeployment(config: string, secretNames: string[], verified: string | undefined): void {
  if (verified !== "true") {
    throw new Error("Verify the Spotify lyrics probe with a real, signed-in Spicetify client first, then set LYRICS_AUTH_COMPATIBILITY_VERIFIED=true. See docs/lyrics-access.md.");
  }
  if (!secretNames.includes("LYRICS_SESSION_SECRET")) {
    throw new Error("Configure the independent LYRICS_SESSION_SECRET with wrangler secret put before publishing.");
  }
  const blocks = config.match(/\[\[ratelimits\]\][\s\S]*?(?=\n\[|$)/g) ?? [];
  const namespaces = new Set<string>();
  for (const name of ["LYRICS_SESSION_LIMITER", "LYRICS_TOKEN_LIMITER", "LYRICS_IP_LIMITER"]) {
    const matches = blocks.filter(block => new RegExp(`^\\s*name\\s*=\\s*"${name}"\\s*$`, "m").test(block));
    const namespace = matches[0]?.match(/^\s*namespace_id\s*=\s*"(\d+)"\s*$/m)?.[1];
    if (matches.length !== 1 || !namespace || namespaces.has(namespace)) throw new Error(`Configure a separate rate limit binding for ${name}.`);
    namespaces.add(namespace);
  }
}
