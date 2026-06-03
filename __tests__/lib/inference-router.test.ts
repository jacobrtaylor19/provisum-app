/**
 * Inference router unit tests.
 *
 * Mocks `gatewayGenerateText` so tests don't make real Gateway calls. The
 * matcher-side logic is fully covered; the reasoning path is verified to be
 * invoked with the right shape and to handle parse failures.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the gateway BEFORE importing the module under test.
const mockGateway = vi.fn();
vi.mock("@/lib/ai/gateway-provider", () => ({
  gatewayGenerateText: (...args: unknown[]) => mockGateway(...args),
}));

import { routePersonaAssignment } from "@/lib/ai/inference-router";
import type { PersonaSpec } from "@/lib/matcher";

function fp(...atoms: string[]) {
  return new Set(atoms);
}

const AP_CLERK: PersonaSpec = {
  id: "P-AP-CLERK",
  label: "AP Clerk",
  coreAtoms: fp("post:vendor_invoice@cc", "display:vendor_open_items@cc"),
};

const AP_SUPER: PersonaSpec = {
  id: "P-AP-SUPER",
  label: "AP Supervisor",
  coreAtoms: fp("post:vendor_invoice@cc", "display:vendor_open_items@cc", "approve:blocked_invoice@cc", "display:gl_balance@cc"),
};

const PAY_PROC: PersonaSpec = {
  id: "P-PAY-PROC",
  label: "Payment Processor",
  coreAtoms: fp("pay:outgoing_payment_run@cc", "configure:payment_program@global"),
};

const CATALOG = [AP_CLERK, AP_SUPER, PAY_PROC] as const;


describe("routePersonaAssignment", () => {
  beforeEach(() => {
    mockGateway.mockReset();
  });

  it("uses the matcher and skips reasoning for a clear match", async () => {
    const result = await routePersonaAssignment({
      personId: "U1",
      usage: fp("pay:outgoing_payment_run@cc", "configure:payment_program@global"),
      catalog: CATALOG,
    });
    expect(result.path).toBe("matcher");
    expect(result.personaId).toBe("P-PAY-PROC");
    expect(result.escalated).toBe(false);
    expect(mockGateway).not.toHaveBeenCalled();
  });

  it("escalates to reasoning when the matcher is ambiguous", async () => {
    mockGateway.mockResolvedValueOnce({ text: '{"persona_id":"P-AP-CLERK"}' });
    // AP-Clerk and AP-Supervisor overlap heavily — usage matches Clerk core exactly,
    // but Supervisor's core is a superset so the second similarity is close.
    const result = await routePersonaAssignment({
      personId: "U2",
      usage: fp("post:vendor_invoice@cc", "display:vendor_open_items@cc"),
      catalog: [AP_CLERK, AP_SUPER],
      ambiguityBand: 0.50,
    });
    expect(result.path).toBe("reasoning");
    expect(result.personaId).toBe("P-AP-CLERK");
    expect(result.escalated).toBe(true);
    expect(mockGateway).toHaveBeenCalledTimes(1);
    const call = mockGateway.mock.calls[0][0];
    expect(call.system).toContain("persona_id");
    expect(call.prompt).toContain("Candidate personas");
    expect(call.user).toBeUndefined();
    expect(call.tags).toEqual(["feature:persona-assignment", "env:provisum-runtime"]);
  });

  it("respects matcherOnly: never calls the gateway", async () => {
    const result = await routePersonaAssignment({
      personId: "U3",
      usage: fp("post:vendor_invoice@cc", "display:vendor_open_items@cc"),
      catalog: [AP_CLERK, AP_SUPER],
      matcherOnly: true,
    });
    expect(result.path).toBe("matcher");
    expect(result.escalated).toBe(false);
    expect(mockGateway).not.toHaveBeenCalled();
  });

  it("respects forceReasoning: always calls the gateway", async () => {
    mockGateway.mockResolvedValueOnce({ text: '{"persona_id":"P-PAY-PROC"}' });
    const result = await routePersonaAssignment({
      personId: "U4",
      usage: fp("pay:outgoing_payment_run@cc", "configure:payment_program@global"),  // matcher would resolve cleanly
      catalog: CATALOG,
      forceReasoning: true,
    });
    expect(result.path).toBe("reasoning");
    expect(result.escalated).toBe(false);
    expect(mockGateway).toHaveBeenCalledTimes(1);
  });

  it("passes user + tags through to the gateway for observability", async () => {
    mockGateway.mockResolvedValueOnce({ text: '{"persona_id":"P-AP-CLERK"}' });
    await routePersonaAssignment({
      personId: "U5",
      usage: fp("post:vendor_invoice@cc", "display:vendor_open_items@cc"),
      catalog: [AP_CLERK, AP_SUPER],
      userId: "user-42",
      tags: ["feature:mapping", "team:provisum", "env:prod"],
      ambiguityBand: 0.50,
    });
    const call = mockGateway.mock.calls[0][0];
    expect(call.user).toBe("user-42");
    expect(call.tags).toEqual(["feature:mapping", "team:provisum", "env:prod"]);
  });

  it("returns null persona when the gateway returns garbage", async () => {
    mockGateway.mockResolvedValueOnce({ text: "I cannot answer." });
    const result = await routePersonaAssignment({
      personId: "U6",
      usage: fp("post:vendor_invoice@cc", "display:vendor_open_items@cc"),
      catalog: [AP_CLERK, AP_SUPER],
      ambiguityBand: 0.50,
    });
    expect(result.path).toBe("reasoning");
    expect(result.personaId).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.rawModelOutput).toBe("I cannot answer.");
  });

  it("includes modelVersion in the decision for provenance", async () => {
    mockGateway.mockResolvedValueOnce({ text: '{"persona_id":"P-AP-CLERK"}' });
    const result = await routePersonaAssignment({
      personId: "U7",
      usage: fp("post:vendor_invoice@cc", "display:vendor_open_items@cc"),
      catalog: [AP_CLERK, AP_SUPER],
      model: "openai/gpt-5.4",
      forceReasoning: true,
    });
    expect(result.modelVersion).toBe("openai/gpt-5.4");
    expect(result.path).toBe("reasoning");
  });
});
