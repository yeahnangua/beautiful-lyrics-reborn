export const UserAgent = "beautiful-lyrics-reborn"

// Keep provider-specific compatibility headers and never mutate caller-owned headers.
export const WithUserAgent = (input?: HeadersInit): Record<string, string> => {
	const headers: Record<string, string> = input instanceof Headers || Array.isArray(input)
		? Object.fromEntries(new Headers(input).entries()) : { ...input }
	const key = Object.keys(headers).find(name => name.toLowerCase() === "user-agent") ?? "User-Agent"
	const existing = headers[key]
	headers[key] = existing?.includes(UserAgent) ? existing : [existing, UserAgent].filter(Boolean).join(" ")
	return headers
}

// Chromium versions used by Spotify may discard User-Agent on browser requests.
// Use a local wrapper so Spotify and other extensions keep their own fetch behavior.
export const PluginFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => (
	globalThis.fetch(input, {
		...init,
		headers: WithUserAgent(init?.headers ?? (input instanceof Request ? input.headers : undefined))
	})
)
