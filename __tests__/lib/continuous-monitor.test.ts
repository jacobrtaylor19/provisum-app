import { describe, it, expect, vi } from "vitest";

// continuous-monitor.ts imports @/db, @/db/schema and the incident engine at load.
// Mock them so importing the pure helper doesn't open a connection.
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({
  sodRules: {},
  sodConflicts: {},
  targetPermissions: {},
  targetRolePermissions: {},
  userTargetRoleAssignments: {},
  users: {},
}));
vi.mock("@/lib/incidents/detection", () => ({ detectIncident: vi.fn() }));

import { toIncidentSeverity } from "@/lib/sod/continuous-monitor";

describe("toIncidentSeverity", () => {
  it("maps known rule severities through unchanged", () => {
    expect(toIncidentSeverity("critical")).toBe("critical");
    expect(toIncidentSeverity("high")).toBe("high");
    expect(toIncidentSeverity("low")).toBe("low");
  });

  it("maps 'medium' and anything unrecognized to medium", () => {
    expect(toIncidentSeverity("medium")).toBe("medium");
    expect(toIncidentSeverity("")).toBe("medium");
    expect(toIncidentSeverity("bogus")).toBe("medium");
  });
});
