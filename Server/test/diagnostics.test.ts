import { describe, expect, it, vi } from "vitest";
import { diagnosticsDailyLimit, shouldSaveDiagnostics } from "../src/diagnostics";
import type { RequestDiagnostics } from "../src/types";

describe("diagnostic sampling policy", () => {
  it.each(["success", "cancelled", "failed", "none"] as const)("uses the default rate for %s", outcome => {
    const log = { outcome } as RequestDiagnostics;
    const rate = outcome === "failed" || outcome === "none" ? 0.1 : 0.01;
    expect(shouldSaveDiagnostics({}, log, () => rate - 0.0001)).toBe(true);
    expect(shouldSaveDiagnostics({}, log, () => rate)).toBe(false);
  });
  it("supports disabled and full sampling without calling the random source", () => {
    const random = vi.fn();
    const log = { outcome: "success" } as RequestDiagnostics;
    expect(shouldSaveDiagnostics({ DIAGNOSTICS_SUCCESS_SAMPLE_RATE: "0" }, log, random)).toBe(false);
    expect(shouldSaveDiagnostics({ DIAGNOSTICS_SUCCESS_SAMPLE_RATE: "1" }, log, random)).toBe(true);
    expect(random).not.toHaveBeenCalled();
  });
  it.each(["", " ", "bogus", "NaN", "Infinity", "-1", "1.5"])("falls back to safe sampling for invalid config %j", value => {
    expect(shouldSaveDiagnostics({ DIAGNOSTICS_SUCCESS_SAMPLE_RATE: value }, { outcome: "success" } as RequestDiagnostics, () => 0.02)).toBe(false);
    expect(shouldSaveDiagnostics({ DIAGNOSTICS_FAILURE_SAMPLE_RATE: value }, { outcome: "failed" } as RequestDiagnostics, () => 0.2)).toBe(false);
  });
  it.each([
    [undefined, 1000], ["", 1000], ["-1", 1000], ["bad", 1000], ["Infinity", 1000],
    ["1.5", 1000], ["0", 0], ["25", 25], ["100000", 1000]
  ] as const)("bounds the daily cap for %s", (value, expected) => {
    expect(diagnosticsDailyLimit(value === undefined ? {} : { DIAGNOSTICS_DAILY_LIMIT: value })).toBe(expected);
  });
});
