// Imported Types
import type SpicetifyTypes from "../Types/App/Spicetify.ts"

// Web-Modules
import { Maid } from '@Universal/Modules/Maid.ts'
import { Defer, Timeout } from '@Universal/Modules/Scheduler.ts'

// Spotify Types
export type HistoryLocation = {
	pathname: string;
	search: string;
	hash: string;
	// deno-lint-ignore no-explicit-any
	state: Record<string, any>;
}

// Create our Global-Maid (keeps track of all our sub-processes)
export const GlobalMaid: Maid = new Maid()

// Development Environment Flag (useful for testing purposes)
export const IsDevelopment: boolean = import.meta.url.includes("localhost")

// Store all our Spotify Services
// deno-lint-ignore no-explicit-any
export const Spotify: typeof SpicetifyTypes = (globalThis as any).Spicetify
export let SpotifyPlayer: typeof SpicetifyTypes.Player
export let SpotifyPlatform: typeof SpicetifyTypes.Platform
export let SpotifyHistory: {
	push: ((path: HistoryLocation | string) => void);
	replace: ((path: HistoryLocation | string) => void);
	goBack: (() => void);
	goForward: (() => void);
	listen: ((listener: (location: HistoryLocation) => void) => () => void);
	location: HistoryLocation;
	entries: HistoryLocation[];
}
export let SpotifyPlaybar: typeof Spotify.Playbar
// deno-lint-ignore no-explicit-any
export let SpotifySnackbar: any
export let SpotifyInternalFetch: typeof SpicetifyTypes.CosmosAsync
export let SpotifyURI: typeof SpicetifyTypes.URI
export let SpotifyRequestBuilder: typeof SpicetifyTypes.Platform.RequestBuilder

// Handle Spotify loaded process
let MakeSpotifyReady: () => void
const SpotifyReadyPromise: Promise<void> = new Promise(resolve => MakeSpotifyReady = resolve)
export const OnSpotifyReady = SpotifyReadyPromise
{
	const CheckForServices = () => {
		// Update our service references
		SpotifyPlayer = Spotify.Player
		SpotifyPlatform = Spotify.Platform
		SpotifyHistory = SpotifyPlatform?.History
		SpotifyPlaybar = Spotify.Playbar
		// deno-lint-ignore no-explicit-any
		SpotifySnackbar = (Spotify as any).Snackbar
		SpotifyInternalFetch = Spotify.CosmosAsync
		SpotifyURI = Spotify.URI

		// Determine if we have all our services
		if (
			(SpotifyPlayer === undefined)
			|| (SpotifyPlatform === undefined)
			|| (SpotifyHistory === undefined)
			|| (SpotifyPlaybar === undefined)
			|| (SpotifySnackbar === undefined)
			|| (SpotifyInternalFetch === undefined)
			|| (SpotifyURI === undefined)
		) {
			GlobalMaid.Give(Defer(CheckForServices))
			return
		}

		if (SpotifyRequestBuilder === undefined) {
			// If everything else loaded, our Platform.RequestBuilder should be as well
			SpotifyRequestBuilder = SpotifyPlatform.RequestBuilder

			// Couldn't find it directly so we'll have to search for it (older versions of Spotify primarily)
			if (SpotifyRequestBuilder === undefined) {
				const stack: Record<string, unknown>[] = [Spotify]
				const seenInStack = new Set()
				while (stack.length > 0) {
					const searchIn = stack.pop()!
					for (
						const key
						of [
							...Object.getOwnPropertyNames(searchIn),
							...Object.getOwnPropertyNames(Object.getPrototypeOf(searchIn) || [])
						]
					) {
						// It's possible that indexing into the object will throw an error
						try {
							const value = searchIn[key]
							if (seenInStack.has(value)) {
								continue
							} else if ((value === null) || (value === undefined)) {
								continue
							} else if (typeof value === "object") {
								const prototype = Object.getPrototypeOf(value)
								if (
									(typeof(prototype.resetPendingRequests) === "function")
									&& (typeof(prototype.build) === "function")
									&& (typeof((value as Record<string, unknown>).pendingRequests) === "object")
								) {
									SpotifyRequestBuilder = value
									break
								}
			
								stack.push(value as Record<string, unknown>)
							}
				
							seenInStack.add(value)
						} catch (_) { /* Do nothing */ }
					}

					if (SpotifyRequestBuilder !== undefined) {
						break
					}
				}
			}

			// Failed to find the SpotifyRequestBuilder
			if (SpotifyRequestBuilder === undefined) {
				console.warn("Failed to find SpotifyRequestBuilder")
				GlobalMaid.Give(Defer(CheckForServices))
				return
			}
		}

		GlobalMaid.Give(Defer(MakeSpotifyReady))
	}
	CheckForServices()
}

// Handle token-fetching
type TokenProviderResponse = {
	accessToken: string,
	expiresAtTime: number,
	tokenType: "Bearer"
}
let tokenProviderResponse: (TokenProviderResponse | undefined)
let accessTokenPromise: Promise<string> | undefined
export const GetSpotifyAccessToken = (): Promise<string> => {
	// Determine if we're close to refreshing (meaning we should wait until then)
	if (tokenProviderResponse !== undefined) {
		const timeUntilRefresh = ((tokenProviderResponse.expiresAtTime - Date.now()) / 1000)
		if (timeUntilRefresh <= 2) {
			tokenProviderResponse = undefined
			accessTokenPromise = (
				new Promise(resolve => GlobalMaid.Give(Timeout(timeUntilRefresh, resolve)))
				.then(
					() => {
						accessTokenPromise = undefined
						return GetSpotifyAccessToken() // This actually causes a fetch to happen
					}
				)
			)
			return accessTokenPromise
		}
	}

	// If we already have an access-token promise, return it
	if (accessTokenPromise !== undefined) {
		return accessTokenPromise
	}

	// Otherwise, fetch a new access-token
	accessTokenPromise = (
		SpotifyInternalFetch.get("sp://oauth/v2/token")
		.then(
			(result: TokenProviderResponse) => {
				tokenProviderResponse = result, accessTokenPromise = Promise.resolve(result.accessToken)
				return GetSpotifyAccessToken() // Re-run this to make sure we don't need to refresh again
			}
		)
		.catch(
			(error: Error) => {
				// Means this method of fetching the token is not valid in the used version of Spotify
				if (error.message.includes("Resolver not found")) {
					if (SpotifyPlatform.Session === undefined) {
						console.warn("Failed to find SpotifyPlatform.Session for fetching token")
					} else {
						tokenProviderResponse = {
							accessToken: SpotifyPlatform.Session.accessToken,
							expiresAtTime: SpotifyPlatform.Session.accessTokenExpirationTimestampMs,
							tokenType: "Bearer"
						}
						accessTokenPromise = Promise.resolve(tokenProviderResponse.accessToken)
					}
				}

				return GetSpotifyAccessToken() // Retry fetching the token
			}
		)
	)
	return accessTokenPromise!
}

// Allows for Spotify API requests to be made without CosmosASYNC (which doesn't support all endpoints anymore)
export const SpotifyFetch = (url: string): Promise<Response> => {
	return (
		GetSpotifyAccessToken()
		.then(
			accessToken => fetch(
				url,
				{
					headers: {
						"Authorization": `Bearer ${accessToken}`,
						"Spotify-App-Version": SpotifyPlatform.version,
						"App-Platform": SpotifyPlatform.PlatformData.app_platform
					}
				}
			)
		)
	)
}

// Easy way to show a custom HTML notification
export const ShowNotification = (
	html: string, variant: ("info" | "success" | "warning" | "error" | "default"),
	hideAfter: number
): void => {
	SpotifySnackbar.enqueueSnackbar(
		Spotify.React.createElement(
			"div",
			{
				dangerouslySetInnerHTML: {
					__html: html.trim()
				}
			}
		), {
			variant: variant,
			autoHideDuration: (hideAfter * 1000)
		}
	)
}