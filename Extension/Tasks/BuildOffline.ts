import Bundle from "@Spices/Build/Bundle.ts"

// Produce an installable artifact without changing the user's Spicetify configuration.
const output = await Bundle({ Type: "Offline" }) as string
await Deno.mkdir("./Builds/Offline", { recursive: true })
await Deno.writeTextFile("./Builds/Offline/beautiful-lyrics-reborn.mjs", output)
console.log("Built Builds/Offline/beautiful-lyrics-reborn.mjs")
