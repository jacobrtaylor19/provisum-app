/**
 * Policy rule pack placeholder (Engine PRD §6).
 *
 * Client policy packs (mandatory / forbidden access, segregated geographies,
 * regulatory constraints) attach here. Each engagement may load a different
 * pack; the pack version is recorded in audit provenance.
 *
 * Phase 0 ships the no-op rule + the registry shape. Phase 1+ implements the
 * per-engagement loader once Jacob picks the "rules/policy ownership" model.
 */

import type { DecisionContext, Rule, RuleResult } from "./engine";

const RULE_PACK_VERSION = "1.0.0";

/** Empty pack — clears everything by default until a client-specific pack lands. */
export const policyRule: Rule = {
  id: "RULES_PACK.POLICY.v1",
  name: "Client policy pack (no-op placeholder)",
  async check(ctx: DecisionContext): Promise<RuleResult[]> {
    // Phase 1+: branch on ctx.organizationId to load the engagement's pack.
    void ctx;
    return [];
  },
};

/**
 * Registry stub. Real implementations load a pack by org_id + engagement_id.
 * Returns the default pack today.
 */
export function getPolicyPackForOrg(orgId: number): Rule[] {
  // Phase 1+: look up engagement-specific policy by orgId.
  void orgId;
  return [policyRule];
}

export { RULE_PACK_VERSION };
