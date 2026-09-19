import Bundle from "@Spices/Build/Bundle.ts"
import { BuildVersion } from "@Spices/Build/BuildDetails.ts"

const output = await Bundle({ Type: "Offline" }) as string
const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(output))
const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")
const file = `beautiful-lyrics-reborn.${sha256.slice(0, 16)}.mjs`
const directory = "./Builds/Release"
const release = { schema: 1, version: BuildVersion, sha256, file }
await Deno.mkdir(directory, { recursive: true })
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
