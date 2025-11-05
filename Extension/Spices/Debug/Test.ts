// Standard imports
import { parseArgs } from "jsr:@std/cli@0.223.0"
import { exists } from "jsr:@std/fs@0.223.0"
import { join, extname, fromFileUrl } from "jsr:@std/path@0.223.0"

// TUI Imports
import { tty, colors } from "jsr:@codemonument/cliffy@1.0.0-rc.3/ansi"
import { keypress, type KeyPressEvent } from "jsr:@codemonument/cliffy@1.0.0-rc.3/keypress"

// Oak Imports
import { Application, Status } from "jsr:@oak/oak@16.0.0"

// Spicetify Imports
import { ToggleExtension, Apply, RemoveExtension } from "../Spicetify/Terminal.ts"

// Build Imports
import { SpicetifyEntryPoint, SpicetifyEntryPointPath } from "../Build/BuildDetails.ts"
import Bundle from "../Build/Bundle.ts"

// Web-Module Imports
import { Signal } from "@Universal/Modules/Signal.ts"

// Return our function which is really just used to handle custom port definition
export default async function() {
	// Validate our options
	const options = parseArgs<{port: number}>(Deno.args)
	if (options.port === undefined) {
		throw new Error("You must specify a port to Test with (--port=X).")
	}

	// Store our version
	const versionUpdated = new Signal()
	let testVersion = -1

	// Shared TUI functions
	const ResetScreen = () => {
		tty.cursorSave.cursorHide.cursorTo(0, 0).eraseScreen()
	}
	const DisplayDoneStatus = () => {
		console.log("")
		console.log(colors.bgBlue.rgb24("  Done!  ", 0x161616))
	}
	const DisplayPrompt = () => {
		console.log("")
		console.log(
			colors.rgb24("[Enter] to bundle", 0xFE8C0C), "|",
			colors.rgb24("[Q] to Exit", 0xFF384A), "|",
			colors.rgb24("[L] to Exit and Store Locally", 0xE948FB)
		)
	}

	// Handle bundling
	let UpdateVersion: (dontDisplayPrompt?: true) => Promise<unknown>
	{
		// TUI Functions
		const DisplayPort = () => {
			console.log("")
			console.log(colors.bgWhite.rgb24(`  Port: ${options.port}  `, 0x161616))
		}

		// Actual bundling code
		let bundling = false
		UpdateVersion = (dontDisplayPrompt?: true) => {
			// Make sure we aren't already bundling
			if (bundling) {
				return (undefined as never)
			}
			bundling = true

			// Wipe our screen
			ResetScreen()

			// Display our port again
			DisplayPort()

			// Display our bundling message
			console.log("")
			console.log(colors.bgGreen.rgb24("  Bundling...  ", 0x161616))

			// This emulates the behavior of release version retrieval
			testVersion += 1

			// Now bundle using this version
			return (
				Bundle(
					{
						Type: "Test",
						VersionIdentifier: testVersion.toString()
					}
				)
				.catch(
					(error) => {
						console.log("")
						console.log(colors.bgRed.rgb24("  Failed to Bundle...  ", 0x161616))
						console.log(error)
					}
				)
				.finally(
					() => {
						// Show the uesr the new state
						DisplayDoneStatus()
	
						// Notify our WebSocket connections
						versionUpdated.Fire()
	
						// Display our prompt again
						if (dontDisplayPrompt === undefined) {
							DisplayPrompt()
						}
	
						// Reset our bundling state
						bundling = false
					}
				)
			)
		}
	}

	// Do a first bundle of our project
	await UpdateVersion(true)

	// Now create our server
	const app = new Application()
	{
		app.use( // CORS
			(ctx, next) => {
				ctx.response.headers.set('Access-Control-Allow-Origin', '*')
				return next()
			}
		)
		app.use(
			context => {
				// Handle WebSocket requests
				if (context.request.url.pathname === "/ws") {
					if (context.isUpgradable) {
						const webSocket = context.upgrade()
						
						const versionUpdatedConnection = versionUpdated.Connect(
							() => {
								webSocket.send(testVersion.toString())
							}
						)

						webSocket.onmessage = _ => webSocket.send(testVersion.toString())
						webSocket.onclose = () => versionUpdatedConnection.Disconnect()
					} else {
						context.response.status = Status.BadRequest
						context.response.body = "Needs to be a WebSocket connection."
					}

					return
				}

				// Handle file requests
				const fullPath = join("./Builds/Test", context.request.url.pathname)
				return (
					exists(
						fullPath,
						{
							isFile: true
						}
					)
					.then(
						exists => {
							if (exists) {
								return (
									Deno.readTextFile(fullPath)
									.then(
										contents => {
											context.response.status = Status.OK
											context.response.headers.set(
												"Content-Type",
												(
													(extname(fullPath) === ".css") ? "text/css"
													: extname(fullPath) === ".mjs" ? "text/javascript"
													: "text/plain"
												)
											)
											context.response.body = contents
										}
									)
								)
							} else {
								context.response.status = Status.NotFound
								context.response.body = "Not Found"
							}
						}
					)
				)
			}
		)
	}

	// Handle creating our auto-update entry-point
	{
		// Tell the user that we are applying the extension
		console.log("")
		console.log(colors.bgRed.rgb24("  Applying Extension...  ", 0x161616))

		// Grab our template
		const url = new URL("../AutoUpdate/Templates/AutoUpdate_Test.mjs", import.meta.url)
		const autoUpdateTemplate = await (
			(url.protocol === "file:")
			? Deno.readTextFile(fromFileUrl(url))
			: (
				fetch(url.href)
				.then(response => response.text())
			)
		)

		// Now create our new file with the placeholder port updated to the actual port 
		await Deno.writeTextFile(
			SpicetifyEntryPointPath,
			autoUpdateTemplate.replace("-1", options.port.toString())
		)

		// Apply the extension
		await ToggleExtension(SpicetifyEntryPoint, true)

		// Delay Spotify boot-up until after our server is running (next scheduled process)
		setTimeout(Apply, 0)

		// Display that we've finished this step
		DisplayDoneStatus()
	}

	// Display our prompt
	DisplayPrompt()

	// Handle update requests
	{
		keypress().addEventListener(
			"keydown",
			async (event: KeyPressEvent) => {
				if (
					(event.ctrlKey && event.key === "c")
					|| (event.key === "q")
					|| (event.key === "l")
				) {
					// Prevent all further keypresses
					keypress().dispose()

					// Wipe the screen
					ResetScreen()

					// Send the comands to remove our extension
					if (event.key === "l") {
						// Display that we are starting the process of storing the extension
						console.log("")
						console.log(
							colors.bgRed.rgb24(` ! `, 0x000000)
							+ colors.bgBlack.rgb24(` Storing Extension `, 0xFFFFFF)
						)

						// Just rebuild since we already have the extension toggled
						await Deno.writeTextFile(SpicetifyEntryPointPath, (await Bundle({ Type: "Offline" })) as string)
						await Apply(true)
					} else {
						// Display that we are starting the process of unapplying the extension
						console.log("")
						console.log(
							colors.bgRed.rgb24(` ! `, 0x000000)
							+ colors.bgBlack.rgb24(` Unapplying Extension `, 0xFFFFFF)
						)

						// Remove the extension
						await RemoveExtension(SpicetifyEntryPoint)
					}

					// Now display that we are closing the port/exiting
					console.log("")
					console.log(
						colors.bgRed.rgb24(` ! `, 0x000000)
						+ colors.bgBlack.rgb24(` Closing Port ${options.port} `, 0xFFFFFF)
					)
					console.log("")

					// Finally, exit (forcing the server to close)
					Deno.exit(0)
				} else if (event.key === "return") {
					UpdateVersion()
				}
			}
		)
	}

	// Listen at the end
	app.listen({ port: options.port })
}