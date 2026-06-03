/**
 * Four-tier decision gate (Engine PRD §9).
 *
 * Tiers per §9.2:
 *   auto_confirm | soft_confirm | review | block
 *
 * Composite confidence (§9.1): blend of five signals, each in [0, 1]:
 *   - modelConfidence            : the reasoning model's own certainty
 *   - fingerprintMatchStrength   : how cleanly the person's access maps to the assigned persona
 *   - topDownBottomUpAgreement   : attribute signal vs access signal agreement
 *   - crossCheckAgreement        : persona-mediated vs direct prediction agreement
 *   - rulesClearance             : 1.0 if no warn or block, scaled down by warnings
 *
 * Phase 0 only has model + (legacy "overlap" repurposed as a coarse fingerprint
 * proxy) + (legacy "history" repurposed as a coarse cross-check proxy). Missing
 * components default to a neutral 0.5 — the gate's shape is final; B1/B2 fill in
 * the matcher and the direct-prediction cross-check.
 *
 * SAFETY: SOD as hard gate per §9.2 "safety overrides confidence." If
 * `rulesClearance.blockedBy` is non-empty, the tier is forced to "block"
 * regardless of composite confidence.
 */

import type { RulesClearance } from "@/lib/rules";

export type DecisionTier = "auto_confirm" | "soft_confirm" | "review" | "block";

export interface GateInputs {
  modelConfidence: number;                  // [0,1]
  fingerprintMatchStrength?: number;        // [0,1]; default 0.5 in Phase 0
  topDownBottomUpAgreement?: number;        // [0,1]; default 0.5 in Phase 0
  crossCheckAgreement?: number;             // [0,1]; default 0.5 in Phase 0
  rulesClearance: RulesClearance;
}

export interface GateOutput {
  tier: DecisionTier;
  composite: number;                        // [0,1]
  components: Record<string, number>;
  reason: string;
  safetyOverride: boolean;
}

/** Tier cutoffs. Tunable per engagement (Engine PRD §9.2 last paragraph). */
export interface GateThresholds {
  autoConfirm: number;        // composite ≥ this AND rules cleared
  softConfirm: number;        // composite ≥ this AND rules cleared
  // Below softConfirm → review (unless blocked)
}

export const DEFAULT_THRESHOLDS: GateThresholds = {
  autoConfirm: 0.80,
  softConfirm: 0.55,
};

const DEFAULT_NEUTRAL = 0.5;

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return DEFAULT_NEUTRAL;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function rulesClearanceScore(c: RulesClearance): number {
  if (!c.cleared) return 0; // blocked
  if (c.warnings.length === 0) return 1.0;
  // Each warning shaves 10 percentage points, floored at 0.5.
  return Math.max(0.5, 1.0 - 0.10 * c.warnings.length);
}

/**
 * Pure function: takes inputs and produces a decision tier + the composite + reason.
 * Audit/persistence is the caller's responsibility — this function is referentially
 * transparent and unit-testable.
 */
export function decideTier(inputs: GateInputs, thresholds: GateThresholds = DEFAULT_THRESHOLDS): GateOutput {
  const model = clamp01(inputs.modelConfidence);
  const fp = clamp01(inputs.fingerprintMatchStrength ?? DEFAULT_NEUTRAL);
  const tdbu = clamp01(inputs.topDownBottomUpAgreement ?? DEFAULT_NEUTRAL);
  const xchk = clamp01(inputs.crossCheckAgreement ?? DEFAULT_NEUTRAL);
  const rules = rulesClearanceScore(inputs.rulesClearance);

  // Weights summing to 1.0; chosen per Engine PRD §9.1 priorities.
  const weights = { model: 0.30, fp: 0.25, tdbu: 0.15, xchk: 0.15, rules: 0.15 };
  const composite =
    weights.model * model +
    weights.fp * fp +
    weights.tdbu * tdbu +
    weights.xchk * xchk +
    weights.rules * rules;

  const components = { model, fingerprint: fp, top_down_bottom_up: tdbu, cross_check: xchk, rules };

  // Safety override — Engine PRD §9.2: SOD/policy violation forces block.
  if (!inputs.rulesClearance.cleared) {
    return {
      tier: "block",
      composite,
      components,
      reason: `Blocked by ${inputs.rulesClearance.blockedBy.length} rule(s): ${inputs.rulesClearance.blockedBy.map((r) => r.ruleId).join(", ")}`,
      safetyOverride: true,
    };
  }

  let tier: DecisionTier;
  let reason: string;
  if (composite >= thresholds.autoConfirm) {
    tier = "auto_confirm";
    reason = `Composite ${composite.toFixed(3)} ≥ auto-confirm threshold ${thresholds.autoConfirm}, rules cleared.`;
  } else if (composite >= thresholds.softConfirm) {
    tier = "soft_confirm";
    reason = `Composite ${composite.toFixed(3)} ≥ soft-confirm threshold ${thresholds.softConfirm}, rules cleared.`;
  } else {
    tier = "review";
    reason = `Composite ${composite.toFixed(3)} below soft-confirm threshold ${thresholds.softConfirm}; routed to review.`;
  }
  return { tier, composite, components, reason, safetyOverride: false };
}
