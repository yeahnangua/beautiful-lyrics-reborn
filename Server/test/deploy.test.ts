import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { configureDatabases } from "../Tasks/DatabaseConfig";
import { assertLyricsAuthDeployment } from "../Tasks/AuthDeployment";

const config = await readFile("wrangler.toml", "utf8");
const feedback = "11111111-1111-4111-8111-111111111111";
const cache = "22222222-2222-4222-8222-222222222222";

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

describe("separate deployment databases", () => {
  it.each(["\n", "\r\n"])("resolves lyrics-cache by name and preserves the feedback UUID with %j newlines", newline => {
    const lookup = vi.fn(name => name === "lyrics-cache" ? cache : undefined);
    const output = configureDatabases(config.replace(/\r?\n/g, newline), { FEEDBACK_DATABASE_ID: feedback }, lookup);
    expect(lookup).toHaveBeenCalledExactlyOnceWith("lyrics-cache");
    expect(output).toContain(`binding = "FEEDBACK_DB"${newline}database_name = "beautiful-lyrics-feedback"${newline}database_id = "${feedback}"`);
    expect(output).toContain(`binding = "LYRICS_CACHE_DB"${newline}database_name = "lyrics-cache"${newline}database_id = "${cache}"`);
    expect(output).toContain('migrations_dir = "cache-migrations"');
  });
  it("supports explicitly supplied IDs without querying Cloudflare", () => {
    const lookup = vi.fn();
    configureDatabases(config, { FEEDBACK_DATABASE_ID: feedback, LYRICS_CACHE_DATABASE_ID: cache }, lookup);
    expect(lookup).not.toHaveBeenCalled();
  });
  it("maps IDs by binding when the TOML blocks are reordered", () => {
    const blocks = config.match(/\[\[d1_databases\]\][\s\S]*?(?=\n\[|$)/g)!;
    const output = configureDatabases([...blocks].reverse().join("\n"), { FEEDBACK_DATABASE_ID: feedback, LYRICS_CACHE_DATABASE_ID: cache }, () => undefined);
    expect(output.indexOf(cache)).toBeLessThan(output.indexOf(feedback));
  });
  it("rejects unresolved, invalid or identical database IDs", () => {
    expect(() => configureDatabases(config, { FEEDBACK_DATABASE_ID: feedback }, () => undefined)).toThrow("LYRICS_CACHE_DATABASE_ID");
    expect(() => configureDatabases(config, { FEEDBACK_DATABASE_ID: feedback, LYRICS_CACHE_DATABASE_ID: "invalid" }, () => cache)).toThrow("LYRICS_CACHE_DATABASE_ID");
    expect(() => configureDatabases(config, { FEEDBACK_DATABASE_ID: feedback, LYRICS_CACHE_DATABASE_ID: feedback }, () => undefined)).toThrow("different databases");
  });
  it("rejects missing and duplicate bindings", () => {
    const blocks = config.match(/\[\[d1_databases\]\][\s\S]*?(?=\n\[|$)/g)!;
    const env = { FEEDBACK_DATABASE_ID: feedback, LYRICS_CACHE_DATABASE_ID: cache };
    expect(() => configureDatabases(blocks[0]!, env, () => undefined)).toThrow("Missing database binding");
    expect(() => configureDatabases(config + '\n' + blocks[0], env, () => undefined)).toThrow("Duplicate database binding");
  });
});
