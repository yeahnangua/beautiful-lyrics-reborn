import { Abortable, CreateAbortScope } from "../../../../Universal/Modules/Async.ts"
import type { TrackInformation } from "../Types/API/InternalTrackInformation.ts"

type Options = {
	getCached(songId: string): Promise<TrackInformation | undefined>;
	fetchTrack(songId: string): Promise<TrackInformation>;
	setCached(songId: string, information: TrackInformation): Promise<unknown>;
	timeoutMs?: number;
}

/** Details and lyric lookups share work by song ID, with an independent lifetime. */
export function createTrackInformationLoader(options: Options) {
	const pending = new Map<string, { promise: Promise<TrackInformation>; cancel(): void }>()
	let destroyed = false
	const load = (songId: string): Promise<TrackInformation> => {
		if (destroyed) return Promise.reject(new Error("Track information loader closed"))
		const existing = pending.get(songId)
		if (existing) return existing.promise
		const scope = CreateAbortScope(options.timeoutMs ?? 8000)
		let cacheWrite: Promise<unknown> | undefined
		const promise = Abortable(scope.Signal, async () => {
			const cached = await Promise.resolve().then(() => options.getCached(songId)).catch(() => undefined)
			scope.Signal.throwIfAborted()
			if (cached !== undefined) return cached
			const information = await options.fetchTrack(songId)
			scope.Signal.throwIfAborted()
			// Keep the resolved lookup shareable until persistence settles, without delaying callers.
			cacheWrite = Abortable(scope.Signal, () => options.setCached(songId, information)).catch(() => {})
			return information
		})
		pending.set(songId, { promise, cancel: () => scope.Destroy() })
		const release = () => {
			scope.Destroy()
			if (pending.get(songId)?.promise === promise) pending.delete(songId)
		}
		void promise.then(() => cacheWrite ? cacheWrite.finally(release) : release(), release).catch(() => {})
		return promise
	}
	return Object.assign(load, {
		destroy() {
			destroyed = true
			for (const request of pending.values()) request.cancel()
			pending.clear()
		}
	})
}

export function getTrackIsrc(information: TrackInformation): string | undefined {
	if (!Array.isArray(information.external_id)) return undefined
	for (const entry of information.external_id) {
		if (entry?.type !== "isrc" || typeof entry.id !== "string") continue
		const isrc = entry.id.trim().toUpperCase()
		if (/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc)) return isrc
	}
	return undefined
}

/** Stop this caller waiting without cancelling metadata needed by another consumer. */
export async function resolveTrackIsrc(
	load: (songId: string) => Promise<TrackInformation>, songId: string, parent: AbortSignal, timeoutMs = 1500
): Promise<string | undefined> {
	const scope = CreateAbortScope(timeoutMs, parent)
	try {
		return getTrackIsrc(await Abortable(scope.Signal, () => load(songId)))
	} catch {
		parent.throwIfAborted()
		return undefined
	} finally { scope.Destroy() }
}
