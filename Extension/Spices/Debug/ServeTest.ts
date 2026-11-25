import { resolve, relative, isAbsolute, extname } from "jsr:@std/path@0.223.0"

export async function ReadTestAsset(request: Request, root: string, token: string): Promise<Response> {
	const url = new URL(request.url)
	if (url.searchParams.get("session") !== token) return new Response("Forbidden", { status: 403 })
	if (request.method !== "GET" || !/^\/bundle@\d+\.(?:mjs|css|mjs\.map)$/.test(url.pathname)) return new Response("Not found", { status: 404 })
	try {
		const base = await Deno.realPath(resolve(root))
		const file = await Deno.realPath(resolve(base, url.pathname.slice(1)))
		const within = relative(base, file)
		if (isAbsolute(within) || within === ".." || within.startsWith("../") || within.startsWith("..\\")) return new Response("Forbidden", { status: 403 })
		return new Response(await Deno.readFile(file), { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store",
			"Content-Type": extname(file) === ".css" ? "text/css" : extname(file) === ".mjs" ? "text/javascript" : "application/json",
			"X-Content-Type-Options": "nosniff" } })
	} catch { return new Response("Not found", { status: 404 }) }
}
