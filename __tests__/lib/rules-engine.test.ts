import { describe, it, expect } from "vitest";
import { evaluate, type Rule, type DecisionContext, type RuleResult } from "@/lib/rules/engine";

function makeRule(opts: { id: string; results: RuleResult[] }): Rule {
  return {
    id: opts.id,
    name: opts.id,
    check: async () => opts.results,
  };
}

function ctx(): DecisionContext {
  return { kind: "persona_assignment", subjectId: 1, organizationId: 1, payload: {} };
}

function veto(id: string, severity: "block" | "warn" | "info" = "block"): RuleResult {
  return {
    ruleId: id,
    ruleName: id,
    veto: severity === "block",
    severity,
    rationale: "test",
    rulePackVersion: "1.0.0",
  };
}

describe("rules/engine.evaluate", () => {
  it("returns cleared:true when no rules fire", async () => {
    const clearance = await evaluate([makeRule({ id: "R1", results: [] })], ctx());
    expect(clearance.cleared).toBe(true);
    expect(clearance.blockedBy).toEqual([]);
    expect(clearance.warnings).toEqual([]);
  });

  it("treats only veto+block as blocking", async () => {
    const rule = makeRule({
      id: "R1",
      results: [
        veto("R1::block", "block"),
        veto("R1::warn", "warn"),
        veto("R1::info", "info"),
      ],
    });
    const clearance = await evaluate([rule], ctx());
    expect(clearance.cleared).toBe(false);
    expect(clearance.blockedBy).toHaveLength(1);
    expect(clearance.blockedBy[0].ruleId).toBe("R1::block");
    expect(clearance.warnings).toHaveLength(1);
    expect(clearance.infos).toHaveLength(1);
  });

  it("aggregates results across multiple rules", async () => {
    const a = makeRule({ id: "A", results: [veto("A::block", "block")] });
    const b = makeRule({ id: "B", results: [veto("B::warn", "warn")] });
    const clearance = await evaluate([a, b], ctx());
    expect(clearance.all).toHaveLength(2);
    expect(clearance.cleared).toBe(false);
  });

  it("a warning-only result keeps cleared=true (PRD §9.2 — only blocks veto)", async () => {
    const rule = makeRule({ id: "R", results: [veto("R::warn", "warn")] });
    const clearance = await evaluate([rule], ctx());
    expect(clearance.cleared).toBe(true);
    expect(clearance.warnings).toHaveLength(1);
  });
});
