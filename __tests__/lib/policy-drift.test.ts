import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";

// policy-drift.ts imports @/db and @/db/schema at module load — mock them so the
// import doesn't try to open a real connection. The functions under test are pure.
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({
  targetRoles: {},
  targetPermissions: {},
  targetRolePermissions: {},
  securityDesignChanges: {},
  userTargetRoleAssignments: {},
}));

import { hashPermissionSet, diffPermissions } from "@/lib/policy-drift";

describe("hashPermissionSet", () => {
  it("is order-independent", () => {
    expect(hashPermissionSet(["a", "b", "c"])).toBe(hashPermissionSet(["c", "a", "b"]));
  });

  it("is duplicate-independent", () => {
    expect(hashPermissionSet(["a", "a", "b"])).toBe(hashPermissionSet(["a", "b"]));
  });

  it("changes when the set membership changes", () => {
    expect(hashPermissionSet(["a", "b"])).not.toBe(hashPermissionSet(["a", "b", "c"]));
    expect(hashPermissionSet(["a", "b"])).not.toBe(hashPermissionSet(["a"]));
  });

  it("matches a known sha256 of the sorted, newline-joined set", () => {
    const expected = createHash("sha256").update(["a", "b", "c"].join("\n")).digest("hex");
    expect(hashPermissionSet(["c", "b", "a"])).toBe(expected);
    expect(hashPermissionSet(["a", "b", "c"])).toHaveLength(64);
  });

  it("hashes the empty set deterministically", () => {
    expect(hashPermissionSet([])).toBe(hashPermissionSet([]));
    expect(hashPermissionSet([])).toHaveLength(64);
  });
});

describe("diffPermissions", () => {
  it("detects added permissions", () => {
    expect(diffPermissions(["a", "b"], ["a", "b", "c"])).toEqual({ added: ["c"], removed: [] });
  });

  it("detects removed permissions", () => {
    expect(diffPermissions(["a", "b", "c"], ["a", "c"])).toEqual({ added: [], removed: ["b"] });
  });

  it("detects simultaneous add and remove", () => {
    expect(diffPermissions(["a", "b"], ["a", "c"])).toEqual({ added: ["c"], removed: ["b"] });
  });

  it("returns empty diff for identical sets (order ignored by hash, content equal here)", () => {
    expect(diffPermissions(["a", "b"], ["a", "b"])).toEqual({ added: [], removed: [] });
  });
});
