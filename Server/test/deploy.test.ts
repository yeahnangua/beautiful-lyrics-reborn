import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { configureDatabases } from "../Tasks/DatabaseConfig";

const config = await readFile("wrangler.toml", "utf8");
const feedback = "11111111-1111-4111-8111-111111111111";
const cache = "22222222-2222-4222-8222-222222222222";

describe("separate deployment databases", () => {
  it("resolves lyrics-cache by name and preserves the feedback UUID", () => {
    const lookup = vi.fn(name => name === "lyrics-cache" ? cache : undefined);
    const output = configureDatabases(config, { FEEDBACK_DATABASE_ID: feedback }, lookup);
    expect(lookup).toHaveBeenCalledExactlyOnceWith("lyrics-cache");
    expect(output).toContain(`binding = "FEEDBACK_DB"\ndatabase_name = "beautiful-lyrics-feedback"\ndatabase_id = "${feedback}"`);
    expect(output).toContain(`binding = "LYRICS_CACHE_DB"\ndatabase_name = "lyrics-cache"\ndatabase_id = "${cache}"`);
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
