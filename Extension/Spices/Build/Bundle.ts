// System Imports
import { dirname, join, resolve, relative } from "jsr:@std/path@0.223.0"
import { ensureDir } from "jsr:@std/fs@0.223.0"

// ESBuild Imports
import * as esbuild from "npm:esbuild@0.20.2"
import { denoPlugins } from "jsr:@luca/esbuild-deno-loader@0.11.1"

// Build Imports
import { BuildName, BuildVersion } from "../Build/BuildDetails.ts"
import { compileAsync as SASSCompile } from "npm:sass@1.75.0"
import PostCSS from "npm:postcss@8.4.38"
import AutoPrefixer from "npm:autoprefixer@10.4.19"
import CSSNano from "npm:cssnano@6.1.2"
import CSSAdvancedNanoPreset from "npm:cssnano-preset-advanced@6.1.2"
console.log("HELLO!")
// Helper functions
const WriteTextFile = (path: string, contents: string): Promise<void> => {
	return (
		Deno.mkdir(dirname(path), { recursive: true })
		.then(_ => Deno.writeTextFile(path, contents))
	)
}
const FormatCSSFile = (relativePath: string, css: string) => `/* ${relativePath} */\n${css}`

// Store our namespaces
const SCSSInlineStyleNamespace = "SCSS-Inline-Styles"
const CSSInlineStyleNamespace = "CSS-Inline-Styles"

// Bundle logic
type BundleConfiguration = {
	/*
		Release/Test are the same structure wise, one MJS file, one CSS file, and one MAP file. However,
		Test will NOT apply any optimizations like Release does.

		Offline bundles everything into a SINGLE file (with optimizations), it does NOT support auto-updating;
		this is meant for using the bundle locally in Spicetify without the need for a running Test file-server.
	*/
	Type?: ("Release" | "Test" | "Offline");

	VersionIdentifier?: string;
}
export default async (bundleConfiguration: BundleConfiguration = {}): Promise<unknown> => {
	// Determine any absolute configuration values
	const bundleType = (
		(bundleConfiguration.Type === undefined) ? "Release"
		: bundleConfiguration.Type
	)
	const applyOptimizations = (bundleType !== "Test")
	const versionIdentifier = (
		(bundleConfiguration.VersionIdentifier === undefined) ? BuildVersion
		: bundleConfiguration.VersionIdentifier
	)

	// Define where our build-directory is
	const buildDirectory = (
		(bundleType === "Offline") ? undefined // Offline builds get saved outside of this module
		: join("./Builds", ((bundleType === "Release") ? "Release" : "Test"))
	)

	// Wipe our build-directory (if it exists)
	if (buildDirectory !== undefined) {
		// First, ensure it exists
		await ensureDir(buildDirectory)

		// Now delete everything in it
		for await (const entry of Deno.readDir(buildDirectory)) {
			await Deno.remove(join(buildDirectory, entry.name), { recursive: true })
		}
	}

	// Store all our promises for the build process
	const buildPromises: Promise<unknown>[] = []

	// Setup all our plugins
	const plugins: esbuild.Plugin[] = []
	const rawCSS: string[] = []
	{
		plugins.push(...denoPlugins({ configPath: resolve(Deno.cwd(), "./deno.json") }))

		const postCSSProcessor = PostCSS(
			[
				applyOptimizations ? CSSNano({preset: CSSAdvancedNanoPreset(), plugins: [AutoPrefixer]})
				: AutoPrefixer
			]
		)
		const absoluteSourcePath = resolve("./Source")
		plugins.splice(
			1, 0,
			{
				name: SCSSInlineStyleNamespace,
				setup(build) {
					// Now handle our build steps
					build.onResolve(
						{ filter: /.\.(scss)$/ },
						args => {
							return {
								path: resolve(args.importer, "..", args.path),
								namespace: SCSSInlineStyleNamespace
							}
						}
					)
		
					build.onLoad(
						{
							filter: /.*/,
							namespace: SCSSInlineStyleNamespace
						},
						args => {
							buildPromises.push(
								SASSCompile(args.path)
								.then(
									result => (
										postCSSProcessor.process(
											result.css,
											{ from: args.path }
										)
									)
								)
								.then(result => rawCSS.push(FormatCSSFile(relative(absoluteSourcePath, args.path), result.css)))
							)

							return {
								contents: ""
							}
						}
					)
				}
			},
			{
				name: CSSInlineStyleNamespace,
				setup(build) {
					// Now handle our build steps
					build.onResolve(
						{ filter: /.\.(css)$/ },
						args => {
							return {
								path: resolve(args.importer, "..", args.path),
								namespace: CSSInlineStyleNamespace
							}
						}
					)
		
					build.onLoad(
						{
							filter: /.*/,
							namespace: CSSInlineStyleNamespace
						},
						args => {
							buildPromises.push(
								Deno.readTextFile(args.path)
								.then(
									contents => (
										postCSSProcessor.process(
											contents,
											{ from: args.path }
										)
									)
								)
								.then(result => rawCSS.push(FormatCSSFile(relative(absoluteSourcePath, args.path), result.css)))
							)
						
							return {
								contents: ""
							}
						}
					)
				}
			}
		)
	}

	// Now bundle everything
	buildPromises.push(
		esbuild.build(
			{
				entryPoints: ["./Source/main.ts"],
				outfile: (
					(buildDirectory === undefined) ? undefined
					: join(buildDirectory, `bundle@${versionIdentifier}.mjs`)
				),

				plugins,
	
				platform: "browser",
				format: "esm",
				bundle: true,
				sourcemap: ((buildDirectory === undefined) ? false : "linked"),
				minify: applyOptimizations,
				legalComments: "none",
				write: (buildDirectory !== undefined)
			}
		)
	)

	// Now wait for everything to finish
	if (buildDirectory === undefined) {
		return (
			Promise.all(buildPromises)
			.then(
				results => {
					// We know our final result is going to be our build-result
					const buildResult = (results[results.length - 1] as esbuild.BuildResult)
					
					// Grab our code output
					const code = buildResult.outputFiles![0].text

					// Now compile all our CSS into a single string and create the injection code
					const css = rawCSS.join("\n")
					const cssInjectionCode = `
						{
							const style = document.createElement("style")
							style.id = "${BuildName}"
							style.textContent = \`${css.replace(/`/g, '\\`')}\`
							document.body.appendChild(style)
						};
					`

					// Finally, return our final code
					return `${cssInjectionCode}\n${code}`
				}
			)
		)
	} else {
		return (
			Promise.all(buildPromises)
			.then(_ => WriteTextFile(join(buildDirectory, `bundle@${versionIdentifier}.css`), rawCSS.join("\n")))
		)
	}
}