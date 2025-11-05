// Spicetify Imports
import { ToggleExtension, Apply } from "../Spicetify/Terminal.ts"

// Build Imports
import { SpicetifyEntryPoint, SpicetifyEntryPointPath } from "../Build/BuildDetails.ts"
import Bundle from "../Build/Bundle.ts"

// Functions
export const Store = (): Promise<void> => (
	Bundle({ Type: "Offline" })
	.then(result => Deno.writeTextFile(SpicetifyEntryPointPath, result as string))
	.then(_ => ToggleExtension(SpicetifyEntryPoint, true))
	.then(_ => Apply())
)

export const Remove = (): Promise<void> => (
	ToggleExtension(SpicetifyEntryPoint, false)
	.then(_ => Apply())
	.then(_ => Deno.remove(SpicetifyEntryPointPath))
)