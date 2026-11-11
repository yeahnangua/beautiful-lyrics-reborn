import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { configureDatabases } from "../Tasks/DatabaseConfig";
import { assertLyricsAuthDeployment } from "../Tasks/AuthDeployment";

const config = await readFile("wrangler.toml", "utf8");
const feedback = "11111111-1111-4111-8111-111111111111";

describe("lyrics authentication deployment gate", () => {
  it("requires a real-client compatibility acknowledgement and the independent signing secret", () => {
    expect(() => assertLyricsAuthDeployment(config, ["LYRICS_SESSION_SECRET"], undefined)).toThrow("Spicetify");
    expect(() => assertLyricsAuthDeployment(config, ["ADMIN_SESSION_SECRET"], "true")).toThrow("LYRICS_SESSION_SECRET");
    expect(() => assertLyricsAuthDeployment(config, ["LYRICS_SESSION_SECRET"], "true")).not.toThrow();
  });
  it("rejects absent and shared rate-limit namespaces", () => {
    for (const binding of ["LYRICS_SESSION_LIMITER", "LYRICS_TOKEN_LIMITER", "LYRICS_IP_LIMITER"]) {
      expect(() => assertLyricsAuthDeployment(config.replace(`name = "${binding}"`, 'name = "OTHER"'), ["LYRICS_SESSION_SECRET"], "true")).toThrow(binding);
    }
    expect(() => assertLyricsAuthDeployment(config.replace('namespace_id = "823603"', 'namespace_id = "823602"'), ["LYRICS_SESSION_SECRET"], "true")).toThrow("separate");
    expect(() => assertLyricsAuthDeployment(config.replace('namespace_id = "823606"', 'namespace_id = "823603"'), ["LYRICS_SESSION_SECRET"], "true")).toThrow("separate");
  });
});

describe("Workers Cache deployment", () => {
  it.each(["\n", "\r\n"])("configures only the feedback database with %j newlines", newline => {
    const output = configureDatabases(config.replace(/\r?\n/g, newline), { FEEDBACK_DATABASE_ID: feedback });
    expect(output).toContain('database_id = "' + feedback + '"');
    expect(output).not.toMatch(/LYRICS_CACHE_DB|lyrics-cache|cache-migrations/);
  });
  it("keeps authentication outside the cached entrypoint", () => {
    expect(config).toMatch(/\[exports\.default\.cache\]\s+enabled = false/);
    expect(config).toMatch(/\[exports\.LyricsOrigin\.cache\]\s+enabled = true/);
    expect(config).toContain("cross_version_cache = true");
  });
  it("rejects unresolved IDs and missing or duplicate feedback bindings", () => {
    expect(() => configureDatabases(config, {})).toThrow("FEEDBACK_DATABASE_ID");
    expect(() => configureDatabases(config, { FEEDBACK_DATABASE_ID: "invalid" })).toThrow("FEEDBACK_DATABASE_ID");
    expect(() => configureDatabases("", { FEEDBACK_DATABASE_ID: feedback })).toThrow("Missing database binding");
    const block = config.match(/\[\[d1_databases\]\][\s\S]*?(?=\n\[|$)/)![0];
    expect(() => configureDatabases(config + "\n" + block, { FEEDBACK_DATABASE_ID: feedback })).toThrow("Duplicate database binding");
  });
  it("rejects accidental reintroduction of the retired lyrics database", () => {
    expect(() => configureDatabases(config + '\n[[d1_databases]]\nbinding = "LYRICS_CACHE_DB"\n', { FEEDBACK_DATABASE_ID: feedback }))
      .toThrow("retired");
  });
});
