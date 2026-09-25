import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const directory = join(root, "Extension/Builds/Release");
const manifestPath = "Extension/Builds/Release/latest.json";
const releaseFilePattern = /^beautiful-lyrics-reborn\.[a-f0-9]{16}\.mjs$/;
const readReleaseFile = (text) => {
  const file = JSON.parse(text).file;
  if (!releaseFilePattern.test(file)) throw new Error(`Invalid release file: ${file}`);
  return file;
};

const current = readReleaseFile(readFileSync(join(directory, "latest.json"), "utf8"));
if (!existsSync(join(directory, current))) throw new Error(`Current release is missing: ${current}`);

// Keep the current build and two available predecessors for loader fallbacks.
const keep = new Set([current]);
const commits = execFileSync("git", ["log", "--format=%H", "--", manifestPath], {
  cwd: root, encoding: "utf8",
}).trim().split("\n").filter(Boolean);
for (const commit of commits) {
  if (keep.size === 3) break;
  const manifest = execFileSync("git", ["show", `${commit}:${manifestPath}`], {
    cwd: root, encoding: "utf8",
  });
  const file = readReleaseFile(manifest);
  if (existsSync(join(directory, file))) keep.add(file);
}

for (const file of readdirSync(directory)) {
  if (releaseFilePattern.test(file) && !keep.has(file)) {
    unlinkSync(join(directory, file));
    console.log(`Removed old release ${file}`);
  }
}
console.log(`Keeping ${[...keep].join(", ")}`);
