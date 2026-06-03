import { describe, it, expect } from "vitest";
import { computeLeastPrivilege, leastPrivilegeRule } from "@/lib/rules/least-privilege";
import type { DecisionContext } from "@/lib/rules/engine";

describe("computeLeastPrivilege (pure)", () => {
  it("with persona core+optional: target = core ∪ (optional ∩ usage)", () => {
    const r = computeLeastPrivilege({
      entitlements: new Set(["a", "b", "c", "stale_x"]),
      usage: new Set(["a", "b"]),
      personaCore: new Set(["a", "b"]),
      personaOptional: new Set(["c"]),
    });
    // c is optional and not used → dropped. stale_x not in core/optional → dropped.
    expect(Array.from(r.target).sort()).toEqual(["a", "b"]);
    expect(Array.from(r.excess).sort()).toEqual(["c", "stale_x"]);
  });

  it("an optional atom carries forward only when exercised", () => {
    const r = computeLeastPrivilege({
      entitlements: new Set(["a", "c"]),
      usage: new Set(["a", "c"]),
      personaCore: new Set(["a"]),
      personaOptional: new Set(["c"]),
    });
    expect(r.target.has("c")).toBe(true);
  });

  it("under-grant: a required core atom is missing from entitlements", () => {
    const r = computeLeastPrivilege({
      entitlements: new Set(["a"]),
      usage: new Set(["a"]),
      personaCore: new Set(["a", "b"]),
    });
    expect(Array.from(r.underGrant).sort()).toEqual(["b"]);
  });

  it("falls back to entitlements ∩ usage when persona is not supplied", () => {
    const r = computeLeastPrivilege({
      entitlements: new Set(["a", "b", "c"]),
      usage: new Set(["a", "c"]),
    });
    expect(Array.from(r.target).sort()).toEqual(["a", "c"]);
    expect(Array.from(r.excess).sort()).toEqual(["b"]);
  });
});

describe("leastPrivilegeRule (over-grant warning)", () => {
  function ctx(payload: Record<string, unknown>): DecisionContext {
    return { kind: "target_mapping", subjectId: 1, organizationId: 1, payload };
  }

  it("does not fire when proposed access is within least-privilege target", async () => {
    const results = await leastPrivilegeRule.check(ctx({
      proposedAccess: ["a", "b"],
      entitlements: ["a", "b", "c"],
      usage: ["a", "b"],
      personaCore: ["a", "b"],
    }));
    expect(results).toHaveLength(0);
  });

  it("fires WARN (never block) when over-grant exists", async () => {
    const results = await leastPrivilegeRule.check(ctx({
      proposedAccess: ["a", "b", "c"],   // c is excess (not used, not in core)
      entitlements: ["a", "b", "c"],
      usage: ["a", "b"],
      personaCore: ["a", "b"],
    }));
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe("warn");
    expect(results[0].veto).toBe(false);  // §9.2: only SOD/policy block
    const evidence = results[0].evidence as { over_grant_atoms: string[] };
    expect(evidence.over_grant_atoms).toContain("c");
  });

  it("returns empty for non-applicable decision kinds", async () => {
    const results = await leastPrivilegeRule.check({
      kind: "persona_assignment",
      subjectId: 1,
      organizationId: 1,
      payload: {},
    });
    expect(results).toEqual([]);
  });
});
