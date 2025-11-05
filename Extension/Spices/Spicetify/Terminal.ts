// System Imports
import { dirname, join } from "jsr:@std/path@0.223.0"

// Directory Functions
let storedSpicetifyDirectory: (Promise<string> | undefined)
export const GetSpicetifyDirectory = (): Promise<string> => {
	if (storedSpicetifyDirectory === undefined) {
		return storedSpicetifyDirectory = (
			(
				new Deno.Command(
					"spicetify",
					{
						args: ["-c"],
					}
				)
			).output()
			.then(output => dirname(new TextDecoder('utf-8').decode(output.stdout).trim()))
		)
	} else {
		return storedSpicetifyDirectory
	}
}
export const GetSpicetifyExtensionsDirectory = (
	(): Promise<string> => GetSpicetifyDirectory().then(directory => join(directory, "Extensions"))
)

// Offline-File Functions
export const ToggleExtension = (fileName: string, apply: boolean): Promise<void> => (
	new Deno.Command(
		"spicetify",
		{
			args: ["config", "extensions", (apply ? fileName : `${fileName}-`)],
		}
	)
	.output()
	.then()
)

export const RemoveExtension = (path: string): Promise<void> => (
	ToggleExtension(path, false)
	.then(() => Apply(true))
	.then(GetSpicetifyExtensionsDirectory)
	.then((extensionsDirectory) => Deno.remove(join(extensionsDirectory, path)))
)

// Run Functions
export const Apply = (withDevtools?: true): Promise<void> => (
	new Deno.Command(
		"spicetify",
		{
			args: (withDevtools ? ["apply", "devtool"] : ["apply"]),
		}
	)
	.output()
	.then()
)