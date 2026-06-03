/**
 * Least-privilege rule (Engine PRD §6, §4.4).
 *
 * "Target access is built up from demonstrated need rather than carried forward
 * from legacy entitlements. The engine's bias is to grant the minimum the evidence
 * supports and to flag the rest as excess."
 *
 * Phase 0 ships a *pure-function* implementation that any caller can invoke
 * directly: given an entitlement set and a usage set, return the least-privilege
 * target (= used ∩ entitlements ∪ structurally-required atoms). This mirrors the
 * Python rule in `ml/v2/rules/least_privilege.py` so the dataset and engine agree
 * on the contract.
 *
 * Phase 1+: the rule moves behind the `Rule` interface to participate in the gate
 * directly. For Phase 0 we expose the calculator + a thin Rule adapter that
 * surfaces over-grant warnings against a passed `target_access` proposal.
 */

import type { DecisionContext, Rule, RuleResult } from "./engine";

const RULE_PACK_VERSION = "1.0.0";

export interface LeastPrivilegeInputs {
  /** Atoms the person currently holds (entitlement export). */
  entitlements: Set<string>;
  /** Atoms the person actually exercised (usage sample). */
  usage: Set<string>;
  /** Atoms the assigned persona's core fingerprint REQUIRES regardless of usage. */
  personaCore?: Set<string>;
  /** Atoms the assigned persona's fingerprint OFFERS only if exercised. */
  personaOptional?: Set<string>;
}

export interface LeastPrivilegeResult {
  /** The least-privilege target access set. */
  target: Set<string>;
  /** Atoms in `entitlements` but not in `target` — should be removed. */
  excess: Set<string>;
  /** Atoms the persona requires but the person does not hold. */
  underGrant: Set<string>;
}

/**
 * Compute the least-privilege target set. Pure function; deterministic.
 *
 * target = personaCore ∪ (personaOptional ∩ usage)
 *
 * If `personaCore`/`personaOptional` are not provided, fall back to:
 *   target = entitlements ∩ usage
 * which is the usage-only proxy — a coarser least-privilege approximation.
 */
export function computeLeastPrivilege(input: LeastPrivilegeInputs): LeastPrivilegeResult {
  const target = new Set<string>();
  if (input.personaCore || input.personaOptional) {
    if (input.personaCore) input.personaCore.forEach((a) => target.add(a));
    if (input.personaOptional) {
      input.personaOptional.forEach((a) => {
        if (input.usage.has(a)) target.add(a);
      });
    }
  } else {
    input.entitlements.forEach((a) => {
      if (input.usage.has(a)) target.add(a);
    });
  }
  const excess = new Set<string>();
  input.entitlements.forEach((a) => {
    if (!target.has(a)) excess.add(a);
  });
  const underGrant = new Set<string>();
  if (input.personaCore) {
    input.personaCore.forEach((a) => {
      if (!input.entitlements.has(a)) underGrant.add(a);
    });
  }
  return { target, excess, underGrant };
}

/**
 * Rule adapter: flag over-grant of a proposed target_access against the
 * least-privilege computation. Used by the gate to surface "this assignment
 * grants more than the evidence supports" warnings.
 */
export const leastPrivilegeRule: Rule = {
  id: "RULES_PACK.LEAST_PRIVILEGE.v1",
  name: "Least-privilege — proposed access exceeds usage-justified set",
  async check(ctx: DecisionContext): Promise<RuleResult[]> {
    if (ctx.kind !== "target_mapping" && ctx.kind !== "access_grant") return [];
    const p = ctx.payload as {
      proposedAccess?: string[];
      entitlements?: string[];
      usage?: string[];
      personaCore?: string[];
      personaOptional?: string[];
    };
    if (!p?.proposedAccess || !p.entitlements || !p.usage) return [];

    const lp = computeLeastPrivilege({
      entitlements: new Set(p.entitlements),
      usage: new Set(p.usage),
      personaCore: p.personaCore ? new Set(p.personaCore) : undefined,
      personaOptional: p.personaOptional ? new Set(p.personaOptional) : undefined,
    });

    const overGrant: string[] = [];
    for (const a of p.proposedAccess) {
      if (!lp.target.has(a)) overGrant.push(a);
    }
    if (overGrant.length === 0) return [];

    return [
      {
        ruleId: "RULES_PACK.LEAST_PRIVILEGE.v1::over_grant",
        ruleName: "Proposed access exceeds least-privilege target",
        veto: false, // over-grant warns; SOD vetos (PRD §9.2 — confidence can push past warn, never past block)
        severity: "warn",
        rationale: `${overGrant.length} atom(s) proposed beyond the usage-justified set.`,
        evidence: { over_grant_atoms: overGrant.slice(0, 25) },
        rulePackVersion: RULE_PACK_VERSION,
      },
    ];
  },
};
