import Bundle from "@Spices/Build/Bundle.ts"

const output = await Bundle({ Type: "Offline" })
await Deno.mkdir("./Builds/Release", { recursive: true })
await Deno.writeTextFile(
	"./Builds/Release/beautiful-lyrics-reborn.mjs",
	output as string
)
