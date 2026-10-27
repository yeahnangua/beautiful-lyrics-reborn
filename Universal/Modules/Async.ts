export async function Abortable<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
	signal.throwIfAborted()
	let onAbort = () => {}
	try {
		return await Promise.race([
			new Promise<never>((_, reject) => {
				// An aborted signal without a reason must still reject with an Error,
				// otherwise callers only see an undefined rejection value.
				onAbort = () => reject(signal.reason ?? new Error("Operation aborted"))
				signal.addEventListener("abort", onAbort, { once: true })
			}),
			Promise.resolve().then(() => { signal.throwIfAborted(); return operation() })
		])
	} finally { signal.removeEventListener("abort", onAbort) }
}

export type AbortScope = {
	Signal: AbortSignal
	/** Absolute timestamp this scope expires at. */
	Deadline: number
	/** Milliseconds left before expiry; negative once expired. */
	Remaining(): number
	Cancel(reason?: unknown): void
	/** Releases the timer and parent listener without aborting the signal. */
	Detach(): void
	/** Detach and abort. Default teardown for existing callers. */
	Destroy(): void
}

/** A bare signal or another scope, so budgets can nest. */
export type AbortParent = AbortSignal | { Signal?: AbortSignal | undefined; Deadline?: number | undefined }

const UnwrapParent = (parent?: AbortParent) => {
	if (parent === undefined) return { signal: undefined, deadline: Infinity }
	// A scope may carry only a deadline, e.g. an inherited absolute cutoff.
	if ("Signal" in parent || "Deadline" in parent) {
		const inherited = parent as { Signal?: AbortSignal | undefined; Deadline?: number | undefined }
		return { signal: inherited.Signal, deadline: inherited.Deadline ?? Infinity }
	}
	return { signal: parent as AbortSignal, deadline: Infinity }
}

export function CreateAbortScope(milliseconds: number, parent?: AbortParent): AbortScope {
	const inherited = UnwrapParent(parent)
	const controller = new AbortController()
	const cancel = () => controller.abort(inherited.signal?.reason)
	// A nested scope may never outlive its parent's absolute deadline.
	const deadline = Math.min(Date.now() + milliseconds, inherited.deadline)
	const detach = () => {
		clearTimeout(timer)
		inherited.signal?.removeEventListener("abort", cancel)
	}
	inherited.signal?.addEventListener("abort", cancel, { once: true })
	if (inherited.signal?.aborted) cancel()
	if (deadline <= Date.now()) controller.abort(new DOMException("Request timed out", "TimeoutError"))
	const timer = setTimeout(
		() => controller.abort(new DOMException("Request timed out", "TimeoutError")),
		Math.max(0, deadline - Date.now())
	)
	return {
		Signal: controller.signal,
		Deadline: deadline,
		Remaining: () => deadline - Date.now(),
		Cancel: (reason?: unknown) => controller.abort(reason),
		Detach: detach,
		Destroy() { detach(); controller.abort() }
	}
}

/**
 * Resolves with the first candidate to pass `accept`. Rejected candidates are
 * discarded, and an exhausted or empty list resolves to undefined, so callers
 * use one `if` instead of counting settlements by hand.
 */
export function FirstQualified<T>(candidates: readonly Promise<T>[], accept: (value: T) => boolean = () => true): Promise<T | undefined> {
	return Promise.any(candidates.map(async candidate => {
		const value = await candidate
		if (!accept(value)) throw new Error("Candidate rejected")
		return value
	})).catch(() => undefined)
}

/** A cancellable delay releases its timer immediately when the song changes. */
export async function Delay(milliseconds: number, signal: AbortSignal) {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		await Abortable(signal, () => new Promise<void>(resolve => { timer = setTimeout(resolve, milliseconds) }))
	} finally { if (timer !== undefined) clearTimeout(timer) }
}
