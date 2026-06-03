/**
 * Deterministic rules engine (Engine PRD §6).
 *
 * A `Rule` evaluates a `DecisionContext` and returns a `RuleResult`. Rules:
 *  - run alongside every learned stage (§5 Guard)
 *  - can VETO a learned proposal (`veto: true` + `severity: "block"`)
 *  - are deterministic and unit-tested
 *
 * Phase 0 ships the interface, the SOD rule (ported from `lib/sod-analysis.ts`),
 * a least-privilege placeholder, and a policy placeholder. Phase 1 adds the
 * canonical-atom backend so least-privilege can compute against the same atom
 * shape used by the ml/v2 dataset.
 *
 * IMPORTANT: this module is additive. Existing SOD detection in
 * `lib/sod-analysis.ts` keeps working. The rules engine is a NEW path that
 * call sites can adopt incrementally — code that doesn't import from
 * `lib/rules/` is unaffected.
 */

export type RuleSeverity = "info" | "warn" | "block";

export interface DecisionContext {
  /** The decision under evaluation. */
  kind: "persona_assignment" | "target_mapping" | "access_grant";
  /** Who/what is being acted on (e.g. userId). */
  subjectId: string | number;
  /** Org context (multi-tenancy). */
  organizationId: number;
  /** Free-form fields the rule reads. */
  payload: Record<string, unknown>;
}

export interface RuleResult {
  ruleId: string;
  ruleName: string;
  /** true if the rule found a violation. */
  veto: boolean;
  severity: RuleSeverity;
  /** Human-readable rationale. Captured in provenance. */
  rationale: string;
  /** Evidence the rule cites (atoms held, rule pair, policy clause). */
  evidence?: Record<string, unknown>;
  /** Used for audit + reproducibility. */
  rulePackVersion: string;
}

export interface Rule {
  /** Stable id used in audit + rule-pack diffs. */
  readonly id: string;
  readonly name: string;
  /** Returns one or more results — a rule may fire multiple violations. */
  check(ctx: DecisionContext): Promise<RuleResult[]>;
}

/**
 * Aggregate result of running every rule against one decision.
 * Used by the gate (`lib/ai/gate.ts`) to enforce hard veto.
 */
export interface RulesClearance {
  cleared: boolean;
  blockedBy: RuleResult[];
  warnings: RuleResult[];
  infos: RuleResult[];
  /** Every fired result for the audit trail. */
  all: RuleResult[];
}

/** Run every rule in a pack against one decision context. */
export async function evaluate(rules: Rule[], ctx: DecisionContext): Promise<RulesClearance> {
  const all: RuleResult[] = [];
  for (const rule of rules) {
    const results = await rule.check(ctx);
    all.push(...results);
  }
  const blockedBy = all.filter((r) => r.veto && r.severity === "block");
  const warnings = all.filter((r) => !r.veto && r.severity === "warn");
  const infos = all.filter((r) => r.severity === "info");
  return {
    cleared: blockedBy.length === 0,
    blockedBy,
    warnings,
    infos,
    all,
  };
}
