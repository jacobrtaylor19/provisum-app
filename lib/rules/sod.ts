/**
 * SOD rule wrapper (Engine PRD §6, §17.1 — "promote to seed of deterministic rules engine").
 *
 * The existing SOD detection in `lib/sod-analysis.ts` is the authoritative
 * implementation today. This module wraps it behind the `Rule` interface so
 * callers can use the rules engine without duplicating logic. The wrapper
 * READS from the existing tables (`sodRules`, `sodConflicts`) and turns them
 * into `RuleResult[]` — it does not detect conflicts itself.
 *
 * Phase 0: read-only adapter, no schema change.
 * Phase 1+: the SOD detector itself moves behind the Rule interface, with
 * the existing function kept as a back-compat shim.
 */

import { db } from "@/db";
import * as schema from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { DecisionContext, Rule, RuleResult } from "./engine";

const RULE_PACK_VERSION = "1.0.0";

export const sodRule: Rule = {
  id: "RULES_PACK.SOD.v1",
  name: "Segregation of Duties — unresolved conflicts veto",
  async check(ctx: DecisionContext): Promise<RuleResult[]> {
    if (ctx.kind !== "persona_assignment" && ctx.kind !== "access_grant" && ctx.kind !== "target_mapping") {
      return [];
    }
    const userId = typeof ctx.subjectId === "string" ? Number(ctx.subjectId) : ctx.subjectId;
    if (!Number.isFinite(userId)) return [];

    // Read open SOD conflicts for this user, scoped to org.
    // `sodConflicts` carries `organization_id` via the user FK; we filter on the user.
    const open = await db
      .select({
        id: schema.sodConflicts.id,
        sodRuleId: schema.sodConflicts.sodRuleId,
        severity: schema.sodConflicts.severity,
        resolutionStatus: schema.sodConflicts.resolutionStatus,
        riskExplanation: schema.sodConflicts.riskExplanation,
      })
      .from(schema.sodConflicts)
      .where(
        and(
          eq(schema.sodConflicts.userId, userId),
          inArray(schema.sodConflicts.resolutionStatus, ["open", "remapping", "escalated"]),
        ),
      );

    if (open.length === 0) return [];

    // Map each conflict to a RuleResult. Severity maps directly: critical/high → block,
    // medium → warn, low → info. Only "block"-severity results VETO the decision.
    return open.map((c) => {
      const sev = (c.severity ?? "medium").toLowerCase();
      const ruleSeverity = sev === "critical" || sev === "high" ? "block" : sev === "medium" ? "warn" : "info";
      return {
        ruleId: `RULES_PACK.SOD.v1::${c.sodRuleId ?? "unknown"}`,
        ruleName: "Open SOD conflict for user",
        veto: ruleSeverity === "block",
        severity: ruleSeverity as RuleResult["severity"],
        rationale:
          c.riskExplanation ??
          `User has an unresolved ${sev}-severity SOD conflict (resolution status: ${c.resolutionStatus}).`,
        evidence: {
          sod_conflict_id: c.id,
          sod_rule_id: c.sodRuleId,
          resolution_status: c.resolutionStatus,
        },
        rulePackVersion: RULE_PACK_VERSION,
      };
    });
  },
};
