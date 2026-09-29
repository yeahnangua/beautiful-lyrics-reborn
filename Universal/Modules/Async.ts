export async function Abortable<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
	signal.throwIfAborted()
	let onAbort = () => {}
	try {
		return await Promise.race([
			new Promise<never>((_, reject) => {
				onAbort = () => reject(signal.reason)
				signal.addEventListener("abort", onAbort, { once: true })
			}),
			Promise.resolve().then(() => { signal.throwIfAborted(); return operation() })
		])
	} finally { signal.removeEventListener("abort", onAbort) }
}

export function CreateAbortScope(milliseconds: number, parent?: AbortSignal) {
	const controller = new AbortController()
	const cancel = () => controller.abort(parent?.reason)
	parent?.addEventListener("abort", cancel, { once: true })
	if (parent?.aborted) cancel()
	const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), milliseconds)
	return {
		Signal: controller.signal,
		Destroy() { clearTimeout(timer); parent?.removeEventListener("abort", cancel); controller.abort() }
	}
}

/** A cancellable delay releases its timer immediately when the song changes. */
export async function Delay(milliseconds: number, signal: AbortSignal) {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		await Abortable(signal, () => new Promise<void>(resolve => { timer = setTimeout(resolve, milliseconds) }))
	} finally { if (timer !== undefined) clearTimeout(timer) }
}
