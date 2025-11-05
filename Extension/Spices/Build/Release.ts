// Standard imports
import { join, fromFileUrl } from "jsr:@std/path@0.223.0"

// TUI Imports
import { tty, colors } from "jsr:@codemonument/cliffy@1.0.0-rc.3/ansi"

// Spicetify Imports
import { ToggleExtension, Apply } from "../Spicetify/Terminal.ts"

// Build Imports
import { SpicetifyEntryPoint, SpicetifyEntryPointPath, BuildName, BuildReleaseLocation, BuildVersion } from "../Build/BuildDetails.ts"
import Bundle from "../Build/Bundle.ts"

// Return our function which is really just used to handle custom port definition
const DisplayDoneStatus = () => {
	console.log("")
	console.log(colors.bgBlue.rgb24("  Done!  ", 0x161616))
}
export default async function(forceToVersion?: true) {
	// Make sure we aren't trying to release for GitHub (not supported yet)
	if (BuildReleaseLocation.Type === "GitHub") {
		throw new Error("Releasing to GitHub is not supported yet.")
	}

	// Reset our screen
	tty.cursorSave.cursorHide.cursorTo(0, 0).eraseScreen()

	// Display our bundling message
	console.log("")
	console.log(colors.bgGreen.rgb24("  Bundling for Release...  ", 0x161616))

	// Start bundling
	await (
		Bundle({ Type: "Release" })
		.catch(
			(error) => {
				console.log("")
				console.log(colors.bgRed.rgb24("  Failed to Bundle...  ", 0x161616))
				console.log(error)
			}
		)
		.finally(DisplayDoneStatus)
	)

	// Tell the user that we are creating the entry-point for the extension
	console.log("")
	console.log(colors.bgRed.rgb24("  Creating Auto-Update Entry-Point...  ", 0x161616))

	// Grab our template
	const url = new URL(
		"../AutoUpdate/Templates/AutoUpdate_Release_Hosted.mjs",
		import.meta.url
	)
	const autoUpdateTemplate = await (
		(url.protocol === "file:")
		? Deno.readTextFile(fromFileUrl(url))
		: (
			fetch(url.href)
			.then(response => response.text())
		)
	)

	// Replace temporary values with actual values to be used
	const autoUpdateFile = (
		autoUpdateTemplate
		.replace("-1", `${BuildReleaseLocation.Url}/${encodeURIComponent(BuildName)}`)
		.replace("-2", `${BuildReleaseLocation.VersionCheckUrl}/${encodeURIComponent(BuildName)}`)
		.replace("-3", (forceToVersion ? `"${BuildVersion}"` : "undefined"))
	)
	await Deno.writeTextFile(join("./Builds", "Release", `${BuildName}.mjs`), autoUpdateFile)

	// Display that we've finished
	DisplayDoneStatus()
}

export const TestReleaseAutoUpdater = async () => {
	// Make sure we aren't trying to release for GitHub (not supported yet)
	if (BuildReleaseLocation.Type === "GitHub") {
		throw new Error("Releasing to GitHub is not supported yet.")
	}

	// Tell the user that we are applying the extension
	console.log("")
	console.log(colors.bgRed.rgb24("  Getting Auto-Update File...  ", 0x161616))

	// Grab our auto-update file text
	const autoUpdateFile = await Deno.readTextFile(join("./Builds", "Release", `${BuildName}.mjs`))

	// Tell the user that we are applying the extension
	console.log("")
	console.log(colors.bgMagenta.rgb24("  Applying Test File...  ", 0x161616))

	// Now create our new file with the placeholder port updated to the actual port 
	await Deno.writeTextFile(SpicetifyEntryPointPath, autoUpdateFile)

	// Apply the extension
	await ToggleExtension(SpicetifyEntryPoint, true)

	// Delay Spotify boot-up until after our server is running (next scheduled process)
	setTimeout(Apply, 0)

	// Display that we've finished this step
	DisplayDoneStatus()
}