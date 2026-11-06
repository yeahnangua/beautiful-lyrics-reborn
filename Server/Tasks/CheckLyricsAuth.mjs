import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { assertLyricsAuthDeployment } from "./AuthDeployment.ts";

export const wranglerBin = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const directory = fileURLToPath(new URL("../", import.meta.url));
export async function checkLyricsAuthDeployment() {
  const config = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");
  const verified = process.env.LYRICS_AUTH_COMPATIBILITY_VERIFIED;
  if (verified !== "true") assertLyricsAuthDeployment(config, [], verified);
  const result = spawnSync(process.execPath, [wranglerBin, "secret", "list"], {
    cwd: directory, encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "inherit"]
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Cannot verify the Worker signing secret. Deployment stopped.");
  const secrets = JSON.parse(result.stdout);
  if (!Array.isArray(secrets)) throw new Error("Invalid Worker secret metadata. Deployment stopped.");
  assertLyricsAuthDeployment(config, secrets.map(secret => secret.name), verified);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await checkLyricsAuthDeployment();
    console.log("Lyrics authentication deployment checks passed.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
