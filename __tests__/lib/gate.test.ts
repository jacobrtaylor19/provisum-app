import { describe, it, expect } from "vitest";
import { decideTier, DEFAULT_THRESHOLDS } from "@/lib/ai/gate";
import type { RulesClearance, RuleResult } from "@/lib/rules";

function cleared(): RulesClearance {
  return { cleared: true, blockedBy: [], warnings: [], infos: [], all: [] };
}

function blocked(by: string[]): RulesClearance {
  const blockedBy: RuleResult[] = by.map((id) => ({
    ruleId: id, ruleName: id, veto: true, severity: "block",
    rationale: "", rulePackVersion: "1.0.0",
  }));
  return { cleared: false, blockedBy, warnings: [], infos: [], all: blockedBy };
}

function withWarnings(n: number): RulesClearance {
  const warnings: RuleResult[] = Array.from({ length: n }, (_, i) => ({
    ruleId: `W::${i}`, ruleName: "warn", veto: false, severity: "warn",
    rationale: "", rulePackVersion: "1.0.0",
  }));
  return { cleared: true, blockedBy: [], warnings, infos: [], all: warnings };
}

describe("ai/gate.decideTier", () => {
  it("auto_confirm when composite >= threshold and rules cleared", () => {
    const r = decideTier({
      modelConfidence: 0.95,
      fingerprintMatchStrength: 0.9,
      topDownBottomUpAgreement: 0.85,
      crossCheckAgreement: 0.8,
      rulesClearance: cleared(),
    });
    expect(r.tier).toBe("auto_confirm");
    expect(r.safetyOverride).toBe(false);
  });

  it("soft_confirm in the middle band", () => {
    const r = decideTier({
      modelConfidence: 0.6,
      fingerprintMatchStrength: 0.6,
      topDownBottomUpAgreement: 0.6,
      crossCheckAgreement: 0.6,
      rulesClearance: cleared(),
    });
    expect(r.tier).toBe("soft_confirm");
  });

  it("review below the soft-confirm threshold", () => {
    const r = decideTier({
      modelConfidence: 0.3,
      fingerprintMatchStrength: 0.3,
      topDownBottomUpAgreement: 0.3,
      crossCheckAgreement: 0.3,
      rulesClearance: cleared(),
    });
    expect(r.tier).toBe("review");
  });

  it("block forces regardless of composite when rules don't clear (§9.2 safety override)", () => {
    const r = decideTier({
      modelConfidence: 0.99,
      fingerprintMatchStrength: 0.99,
      topDownBottomUpAgreement: 0.99,
      crossCheckAgreement: 0.99,
      rulesClearance: blocked(["SOD-001"]),
    });
    expect(r.tier).toBe("block");
    expect(r.safetyOverride).toBe(true);
    expect(r.reason).toContain("SOD-001");
  });

  it("missing optional inputs default to neutral 0.5", () => {
    const r = decideTier({
      modelConfidence: 0.95,
      rulesClearance: cleared(),
    });
    // With only model high (0.30 weight), fingerprint/tdbu/xchk/rules at 0.5/0.5/0.5/1.0:
    // composite = 0.30*0.95 + 0.25*0.5 + 0.15*0.5 + 0.15*0.5 + 0.15*1.0 = 0.285 + 0.125 + 0.075 + 0.075 + 0.15 = 0.71
    expect(r.components.fingerprint).toBe(0.5);
    expect(r.components.top_down_bottom_up).toBe(0.5);
    expect(r.composite).toBeGreaterThan(0.7);
    expect(r.composite).toBeLessThan(0.72);
  });

  it("rules warnings shave the composite but do not block", () => {
    const noWarn = decideTier({ modelConfidence: 0.95, fingerprintMatchStrength: 0.95, rulesClearance: cleared() });
    const oneWarn = decideTier({ modelConfidence: 0.95, fingerprintMatchStrength: 0.95, rulesClearance: withWarnings(1) });
    expect(oneWarn.composite).toBeLessThan(noWarn.composite);
    expect(oneWarn.tier).not.toBe("block");
  });

  it("clamps out-of-range inputs to [0,1]", () => {
    const r = decideTier({
      modelConfidence: 9999,   // garbage
      fingerprintMatchStrength: -5,
      rulesClearance: cleared(),
    });
    expect(r.components.model).toBe(1);
    expect(r.components.fingerprint).toBe(0);
  });

  it("custom thresholds change the cutoffs", () => {
    const r = decideTier({
      modelConfidence: 0.5,
      fingerprintMatchStrength: 0.5,
      topDownBottomUpAgreement: 0.5,
      crossCheckAgreement: 0.5,
      rulesClearance: cleared(),
    }, { autoConfirm: 0.40, softConfirm: 0.30 });
    expect(r.tier).toBe("auto_confirm");
  });
});
