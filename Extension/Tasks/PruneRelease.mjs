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
const runtimeFiles = new Map();
const auxiliaryFiles = new Map();
const remember = text => {
  const descriptor = JSON.parse(text);
  const file = readReleaseFile(text);
  if (descriptor.fullscreen) {
    const runtime = descriptor.fullscreen;
    if (![1,2].includes(runtime.api) || !/^[a-f0-9]{64}$/.test(runtime.sha256) || runtime.file !== `beautiful-lyrics-reborn-fullscreen.${runtime.sha256.slice(0, 16)}.mjs`) throw Error('Invalid fullscreen descriptor');
    if (!existsSync(join(directory, runtime.file))) throw Error(`Missing fullscreen runtime: ${runtime.file}`);
    runtimeFiles.set(file, runtime.file);
    auxiliaryFiles.set(file, Object.values(runtime.assets ?? {}).map(asset => {
      if (!/^beautiful-lyrics-reborn-nebbia\.[a-f0-9]{16}\.json$/.test(asset.file) || !/^[a-f0-9]{64}$/.test(asset.sha256)
        || !existsSync(join(directory,asset.file))) throw Error('Missing or invalid auxiliary resource');
      return asset.file;
    }));
  }
  return file;
};

const current = remember(readFileSync(join(directory, "latest.json"), "utf8"));
if (!existsSync(join(directory, current))) throw new Error(`Current release is missing: ${current}`);

// Keep the current build and two available predecessors for loader fallbacks.
const keep = new Set([current]);
const historyRef = process.env.RELEASE_HISTORY_REF ?? "HEAD";
const commits = execFileSync("git", ["log", historyRef, "--format=%H", "--", manifestPath], {
  cwd: root, encoding: "utf8",
}).trim().split("\n").filter(Boolean);
for (const commit of commits) {
  if (keep.size === 3) break;
  const manifest = execFileSync("git", ["show", `${commit}:${manifestPath}`], {
    cwd: root, encoding: "utf8",
  });
  const file = readReleaseFile(manifest);
  if (existsSync(join(directory, file))) { remember(manifest); keep.add(file); }
}
const keepRuntimes = new Set([...keep].map(file => runtimeFiles.get(file)).filter(Boolean));
const keepAuxiliary = new Set([...keep].flatMap(file => auxiliaryFiles.get(file) ?? []));

for (const file of readdirSync(directory)) {
  if ((releaseFilePattern.test(file) && !keep.has(file)) || (/^beautiful-lyrics-reborn-fullscreen\.[a-f0-9]{16}\.mjs$/.test(file) && !keepRuntimes.has(file))
    || (/^beautiful-lyrics-reborn-nebbia\.[a-f0-9]{16}\.json$/.test(file) && !keepAuxiliary.has(file))) {
    // Freeze the legacy main-branch payloads for already-installed loaders.
    try { execFileSync('git',['ls-files','--error-unmatch',`Extension/Builds/Release/${file}`],{cwd:root,stdio:'ignore'}); continue; } catch {}
    unlinkSync(join(directory, file));
    console.log(`Removed old release ${file}`);
  }
}
console.log(`Keeping ${[...keep].join(", ")}`);
