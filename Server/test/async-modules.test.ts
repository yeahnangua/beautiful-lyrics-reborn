import { describe, expect, it, vi } from "vitest";
import { Abortable, CreateAbortScope, FirstQualified } from "../../Universal/Modules/Async";

describe("Abortable", () => {
  it("rejects immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("gone"));
    await expect(Abortable(controller.signal, async () => "value")).rejects.toThrow("gone");
  });

  it("rejects a pending operation when the signal aborts", async () => {
    const controller = new AbortController();
    const pending = Abortable(controller.signal, () => new Promise<void>(() => {}));
    controller.abort(new Error("changed song"));
    await expect(pending).rejects.toThrow("changed song");
  });

  it("still rejects with an Error when the abort reason is empty", async () => {
    const controller = new AbortController();
    const pending = Abortable(controller.signal, () => new Promise<void>(() => {}));
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(Error);
  });

  it("passes through a value that settles first", async () => {
    await expect(Abortable(new AbortController().signal, async () => 42)).resolves.toBe(42);
  });
});

describe("CreateAbortScope", () => {
  it("aborts with a TimeoutError once the budget runs out", async () => {
    vi.useFakeTimers();
    try {
      const scope = CreateAbortScope(1_000);
      expect(scope.Signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(scope.Signal.aborted).toBe(true);
      expect((scope.Signal.reason as Error).name).toBe("TimeoutError");
      scope.Destroy();
    } finally { vi.useRealTimers(); }
  });

  it("never lets a nested scope outlive its parent", () => {
    const parent = CreateAbortScope(1_000);
    const child = CreateAbortScope(60_000, parent);
    expect(child.Deadline).toBeLessThanOrEqual(parent.Deadline);
    expect(child.Remaining()).toBeLessThanOrEqual(1_000);
    child.Destroy();
    parent.Destroy();
  });

  it("inherits an explicit parent deadline", () => {
    const deadline = Date.now() + 250;
    const scope = CreateAbortScope(60_000, { Deadline: deadline });
    expect(scope.Deadline).toBe(deadline);
    scope.Destroy();
  });

  it("propagates a parent abort", () => {
    const controller = new AbortController();
    const scope = CreateAbortScope(5_000, controller.signal);
    controller.abort(new Error("stop"));
    expect(scope.Signal.aborted).toBe(true);
    expect((scope.Signal.reason as Error).message).toBe("stop");
  });

  it("detaches without aborting, while destroy aborts", () => {
    const detached = CreateAbortScope(5_000);
    detached.Detach();
    expect(detached.Signal.aborted).toBe(false);

    const destroyed = CreateAbortScope(5_000);
    destroyed.Destroy();
    expect(destroyed.Signal.aborted).toBe(true);
  });

  it("stops its timer after detaching", async () => {
    vi.useFakeTimers();
    try {
      const scope = CreateAbortScope(1_000);
      scope.Detach();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(scope.Signal.aborted).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});

describe("FirstQualified", () => {
  it("returns the first candidate that passes the quality gate", async () => {
    const winner = await FirstQualified(
      [Promise.resolve("static"), Promise.resolve("syllable"), Promise.resolve("line")],
      value => value === "syllable" || value === "line"
    );
    expect(winner).toBe("syllable");
  });

  it("resolves undefined when every candidate is rejected by the gate", async () => {
    expect(await FirstQualified([Promise.resolve("static")], () => false)).toBeUndefined();
  });

  it("resolves undefined for an empty list", async () => {
    expect(await FirstQualified([])).toBeUndefined();
  });

  it("ignores failed candidates and keeps waiting for a good one", async () => {
    expect(await FirstQualified([Promise.reject(new Error("upstream down")), Promise.resolve("line")]))
      .toBe("line");
  });

  it("accepts everything by default", async () => {
    expect(await FirstQualified([Promise.resolve(7)])).toBe(7);
  });
});
