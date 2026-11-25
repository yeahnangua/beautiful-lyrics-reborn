import type { RequestContext, UpstreamDetails, UpstreamEvent } from "../types";
import { Abortable, CreateAbortScope } from "../../../Universal/Modules/Async";
import { WithUserAgent } from "../../../Universal/Modules/Http";
import { readBoundedBody } from "../request-boundaries";

/**
 * Bounds even mock or non-cooperative operations, and removes listeners after
 * settlement. A thin wrapper so call sites keep reading `(operation, signal)`.
 */
export const abortable = <T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> =>
  Abortable(signal, operation);

/** Time budget for one stage. Nested scopes inherit the parent's absolute deadline. */
export function requestScope(milliseconds: number, context: RequestContext = {}) {
  const scope = CreateAbortScope(milliseconds, { Signal: context.signal, Deadline: context.deadline });
  return {
    ...(context.scheduler ? { scheduler: context.scheduler } : {}),
    ...(context.diagnostics ? { diagnostics: context.diagnostics } : {}),
    ...(context.trace ? { trace: context.trace } : {}),
    ...(context.sourceBlocks ? { sourceBlocks: context.sourceBlocks } : {}),
    signal: scope.Signal,
    deadline: scope.Deadline,
    // Disposing must not abort siblings that may still win this stage.
    dispose() { scope.Detach(); },
    cancel(reason?: unknown) { scope.Cancel(reason); }
  };
}

/** Buffer the small upstream payload within the same deadline as its headers. */
const fetchContexts = new WeakMap<typeof fetch, RequestContext>();
export function getFetchContext(fetchImpl: typeof fetch): RequestContext {
  return fetchContexts.get(fetchImpl) ?? {};
}
/** Add safe business results after a provider parses its latest response. */
export function recordUpstreamResult(context: RequestContext | undefined, details: UpstreamDetails): void {
  const event = context?.trace?.upstream.at(-1);
  if (!event) return;
  const { codes, ...result } = details;
  Object.assign(event, result);
  if (codes) {
    const defined = Object.fromEntries(Object.entries(codes).filter(([, code]) => Number.isFinite(code)));
    if (Object.keys(defined).length > 0) event.codes = defined;
  }
  if (event.outcome === "success" && (details.result === "api_error" || details.result === "invalid_payload")) {
    event.outcome = "failed";
  }
}
export function contextFetch(fetchImpl: typeof fetch, context: RequestContext = {},
  options: { preserveUserAgent?: boolean } = {}): typeof fetch {
  const perform: typeof fetch = async (input, init) => {
    const urlText = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (context.signal?.aborted || init?.signal?.aborted) {
      context.trace?.upstream.push({ endpoint: new URL(urlText).hostname + new URL(urlText).pathname, durationMs: 0, outcome: "cancelled" });
      (context.signal?.aborted ? context.signal : init?.signal)?.throwIfAborted();
    }
    const reusable = ["music.163.com", "krcs.kugou.com", "u.y.qq.com"].includes(new URL(urlText).hostname);
    const memoKey = urlText + ":" + String(init?.body ?? "");
    const saved = reusable ? context.scheduler?.responses.get(memoKey) : undefined;
    if (saved) {
      context.trace?.upstream.push({endpoint:new URL(urlText).hostname+new URL(urlText).pathname,durationMs:0,outcome:"success",status:saved.status,reused:true});
      return saved.clone();
    }
    const started = Date.now();
    // Host and path only: query strings, request headers and response bodies stay private.
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const event: UpstreamEvent = { endpoint: url.hostname + url.pathname, durationMs: 0, outcome: "pending" };
    context.trace?.upstream.push(event);
    const queue = requestScope(Math.max(0, (context.deadline ?? Date.now() + 15_000) - Date.now()), context);
    const queueSignal = init?.signal ? AbortSignal.any([queue.signal, init.signal]) : queue.signal;
    let release: (() => void) | undefined;
    try { release = await context.scheduler?.acquire(queueSignal, context.trace?.stage); }
    catch (error) {
      event.outcome = queueSignal.aborted ? queueSignal.reason?.name === "TimeoutError" ? "timeout" : "cancelled" : "failed";
      event.durationMs = Date.now() - started;
      throw error;
    }
    finally { queue.dispose(); }
    const scope = requestScope(5_000, context);
    const parentSignal = init?.signal;
    const cancel = () => scope.cancel(parentSignal?.reason);
    parentSignal?.addEventListener("abort", cancel, { once: true });
    if (parentSignal?.aborted) cancel();
    const onAbort = () => {
      if (event.outcome === "pending") {
        event.outcome = scope.signal.reason?.name === "TimeoutError" ? "timeout" : "cancelled";
        event.durationMs = Date.now() - started;
      }
    };
    scope.signal.addEventListener("abort", onAbort, { once: true });
    if (scope.signal.aborted) onAbort();
    try {
      return await abortable(async () => {
        const inputHeaders = init?.headers ?? (input instanceof Request ? input.headers : undefined);
        const headers = options.preserveUserAgent ? new Headers(inputHeaders) : WithUserAgent(inputHeaders);
        const response = await fetchImpl(input, { ...init, headers, signal: scope.signal });
        if (scope.signal.aborted) await response.body?.cancel().catch(() => {});
        scope.signal.throwIfAborted();
        event.status = response.status;
        const bytes = await readBoundedBody(response, 2 * 1024 * 1024, scope.signal);
        scope.signal.throwIfAborted();
        event.outcome = response.ok ? "success" : "failed";
        const buffered = new Response(response.status === 204 || response.status === 205 || response.status === 304 ? null : bytes,
          { status: response.status, statusText: response.statusText, headers: response.headers });
        if (reusable && response.ok) context.scheduler?.remember(memoKey, buffered, bytes.byteLength);
        return buffered;
      }, scope.signal);
    } catch (error) {
      event.outcome = (error instanceof Error && error.name === "TimeoutError") || scope.signal.reason?.name === "TimeoutError" ? "timeout"
        : context.signal?.aborted || parentSignal?.aborted ? "cancelled" : "failed";
      throw error;
    } finally {
      event.durationMs = Date.now() - started;
      scope.signal.removeEventListener("abort", onAbort);
      scope.dispose();
      parentSignal?.removeEventListener("abort", cancel);
      release?.();
    }
  };
  const wrapped: typeof fetch = async (input, init) => {
    for (let attempt = 0; ; attempt++) {
      try { return await perform(input, init); }
      catch (error) {
        if (!context.scheduler || attempt >= 2 || context.signal?.aborted || init?.signal?.aborted
          || Date.now() >= (context.deadline ?? Infinity) || !(error instanceof Error && error.name === "TimeoutError")) throw error;
        if (context.trace) context.trace.retries++;
      }
    }
  };
  fetchContexts.set(wrapped, context);
  return wrapped;
}

export async function withLyricRequestRetries<T>(
  request: (signal: AbortSignal) => Promise<T>, label: string, context: RequestContext = {}
): Promise<T> {
  // Production transport retries individual operations, keeping successful search results.
  if (context.scheduler) {
    const scope = requestScope(Math.max(0, (context.deadline ?? Date.now() + 15_000) - Date.now()), context);
    try { return await abortable(() => request(scope.signal), scope.signal); }
    finally { scope.dispose(); }
  }
  for (let retry = 0; retry <= 2; retry++) {
    const scope = requestScope(5_000, context);
    try {
      return await abortable(() => request(scope.signal), scope.signal);
    } catch (error) {
      if (context.signal?.aborted || Date.now() >= (context.deadline ?? Infinity) || retry === 2 ||
          !(error instanceof Error && error.name === "TimeoutError")) throw error;
      if (context.trace) context.trace.retries++;
    } finally {
      scope.dispose();
    }
  }
  throw new Error(`${label} failed`);
}
