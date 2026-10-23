import Bundle from "@Spices/Build/Bundle.ts"
import { BuildVersion } from "@Spices/Build/BuildDetails.ts"

// Build the runtime first so the main payload pins its exact verified bytes.
const build = new Deno.Command("node", { args: ["Folia/build.mjs"], stdout: "inherit", stderr: "inherit" }).spawn()
if (!(await build.status).success) throw new Error("Folia build failed")
const fullscreenBytes = await Deno.readFile("Folia/dist/folia.mjs")
const fullscreenDigest = await crypto.subtle.digest("SHA-256", fullscreenBytes)
const fullscreenHash = Array.from(new Uint8Array(fullscreenDigest), byte => byte.toString(16).padStart(2, "0")).join("")
const fullscreen = { api: 1, sha256: fullscreenHash, file: `beautiful-lyrics-reborn-fullscreen.${fullscreenHash.slice(0, 16)}.mjs` }
const output = await Bundle({ Type: "Offline", FullscreenRelease: fullscreen }) as string
const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(output))
const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")
const file = `beautiful-lyrics-reborn.${sha256.slice(0, 16)}.mjs`
const directory = "./Builds/Release"
const release = { schema: 1, version: BuildVersion, sha256, file, fullscreen }
await Deno.mkdir(directory, { recursive: true })
try {
  const existing = await Deno.readFile(`${directory}/${fullscreen.file}`)
  if (existing.length !== fullscreenBytes.length || existing.some((byte, index) => byte !== fullscreenBytes[index])) throw new Error("Fullscreen hash collision")
} catch (error) {
  if (!(error instanceof Deno.errors.NotFound)) throw error
  await Deno.writeFile(`${directory}/${fullscreen.file}`, fullscreenBytes)
}
// Retain immutable releases so older loaders and rollbacks keep working.
const path = `${directory}/${file}`
try {
	if (await Deno.readTextFile(path) !== output) throw new Error(`Release hash collision: ${file}`)
} catch (error) {
	if (!(error instanceof Deno.errors.NotFound)) throw error
	await Deno.writeTextFile(path, output)
}
const loader = await Deno.readTextFile("./Spices/AutoUpdate/ReleaseLoader.mjs")
await Deno.writeTextFile(`${directory}/beautiful-lyrics-reborn.mjs`, `${loader}\nawait startReleaseLoader(${JSON.stringify(release)});\n`)
// Publish the pointer last; Worker assets are deployed together as one version.
await Deno.writeTextFile(`${directory}/latest.json`, JSON.stringify(release, null, 2) + "\n")
console.log(`Built ${file}`)
