import type { RequestContext } from "../types";

/** Bound even mock/non-cooperative operations, and remove listeners after settlement. */
export async function abortable<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason ?? new Error("Request aborted"));
        signal.addEventListener("abort", onAbort, { once: true });
      }),
      Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); })
    ]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export function requestScope(milliseconds: number, context: RequestContext = {}) {
  const controller = new AbortController();
  const deadline = Math.min(Date.now() + milliseconds, context.deadline ?? Infinity);
  const cancel = () => controller.abort(context.signal?.reason);
  context.signal?.addEventListener("abort", cancel, { once: true });
  if (context.signal?.aborted) cancel();
  if (deadline <= Date.now()) controller.abort(new DOMException("Request timed out", "TimeoutError"));
  const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), Math.max(0, deadline - Date.now()));
  return {
    signal: controller.signal,
    deadline,
    dispose() { clearTimeout(timer); context.signal?.removeEventListener("abort", cancel); },
    cancel() { controller.abort(); }
  };
}

/** Buffer the small upstream payload within the same deadline as its headers. */
export function contextFetch(fetchImpl: typeof fetch, context: RequestContext = {}): typeof fetch {
  return async (input, init) => {
    const scope = requestScope(5_000, context);
    const parentSignal = init?.signal;
    const cancel = () => scope.cancel();
    parentSignal?.addEventListener("abort", cancel, { once: true });
    if (parentSignal?.aborted) cancel();
    try {
      return await abortable(async () => {
        const response = await fetchImpl(input, { ...init, signal: scope.signal });
        const bytes = await response.arrayBuffer();
        return new Response(response.status === 204 || response.status === 205 || response.status === 304 ? null : bytes,
          { status: response.status, statusText: response.statusText, headers: response.headers });
      }, scope.signal);
    } finally {
      scope.dispose();
      parentSignal?.removeEventListener("abort", cancel);
    }
  };
}

export async function withLyricRequestRetries<T>(
  request: (signal: AbortSignal) => Promise<T>, label: string, context: RequestContext = {}
): Promise<T> {
  for (let retry = 0; retry <= 2; retry++) {
    const scope = requestScope(5_000, context);
    try {
      return await abortable(() => request(scope.signal), scope.signal);
    } catch (error) {
      if (context.signal?.aborted || Date.now() >= (context.deadline ?? Infinity) || retry === 2 ||
          !(error instanceof Error && error.name === "TimeoutError")) throw error;
      console.warn(`[lyrics request] ${label}: timeout, retry ${retry + 1}/2`);
    } finally {
      scope.dispose();
    }
  }
  throw new Error(`${label} failed`);
}
