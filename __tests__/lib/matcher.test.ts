import { describe, it, expect } from "vitest";
import {
  containment,
  discoverPersonas,
  fingerprintSimilarity,
  jaccard,
  matchPerson,
  type PersonaSpec,
} from "@/lib/matcher";

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
  coreAtoms: fp("post:vendor_invoice@cc", "display:vendor_open_items@cc", "approve:blocked_invoice@cc"),
};

const PAY_PROC: PersonaSpec = {
  id: "P-PAY-PROC",
  label: "Payment Processor",
  coreAtoms: fp("pay:outgoing_payment_run@cc", "configure:payment_program@global"),
};

const CATALOG: readonly PersonaSpec[] = [AP_CLERK, AP_SUPER, PAY_PROC];


describe("fingerprint similarity", () => {
  it("jaccard: identical sets = 1", () => {
    expect(jaccard(fp("a", "b"), fp("a", "b"))).toBe(1);
  });

  it("jaccard: disjoint = 0", () => {
    expect(jaccard(fp("a"), fp("b"))).toBe(0);
  });

  it("jaccard: two empty sets = 1 (degenerate but well-defined)", () => {
    expect(jaccard(fp(), fp())).toBe(1);
  });

  it("containment: subset fully contained = 1", () => {
    expect(containment(fp("a"), fp("a", "b"))).toBe(1);
  });

  it("containment: half outside = 0.5", () => {
    expect(containment(fp("a", "x"), fp("a", "b"))).toBe(0.5);
  });

  it("blended similarity weighs Jaccard and containment", () => {
    // Jaccard("a","ab") = 0.5; containment("a","ab") = 1; default blend 0.6/0.4 → 0.7
    expect(fingerprintSimilarity(fp("a"), fp("a", "b"))).toBeCloseTo(0.7, 5);
  });
});


describe("matchPerson", () => {
  it("picks the right persona for a clean AP-Clerk fingerprint", () => {
    const r = matchPerson(
      { personId: "U1", usage: fp("post:vendor_invoice@cc", "display:vendor_open_items@cc") },
      CATALOG,
    );
    expect(r.bestMatch?.persona.id).toBe("P-AP-CLERK");
    expect(r.fingerprintMatchStrength).toBeGreaterThan(0.9);
  });

  it("flags ambiguity when the top two candidates are close (AP-Clerk vs AP-Supervisor)", () => {
    // Usage matches AP-Clerk exactly — but AP-Supervisor's core is a superset, so containment is also high.
    const r = matchPerson(
      { personId: "U1", usage: fp("post:vendor_invoice@cc", "display:vendor_open_items@cc") },
      [AP_CLERK, AP_SUPER],
      { ambiguityBand: 0.30 },
    );
    expect(r.ambiguous).toBe(true);
    expect(r.reason).toMatch(/route to reasoning model/);
  });

  it("flags ambiguity when top similarity is below minSimilarity", () => {
    const r = matchPerson(
      { personId: "U1", usage: fp("totally_unrelated_atom") },
      CATALOG,
      { minSimilarity: 0.5 },
    );
    expect(r.ambiguous).toBe(true);
  });

  it("returns no match for empty catalog", () => {
    const r = matchPerson({ personId: "U1", usage: fp("x") }, []);
    expect(r.bestMatch).toBeNull();
    expect(r.ambiguous).toBe(true);
  });

  it("rejects an empty-usage person (no signal to match on)", () => {
    const r = matchPerson({ personId: "U1", usage: fp() }, CATALOG);
    // jaccard(empty, non-empty) = 0 → top similarity ~0 → ambiguous
    expect(r.ambiguous).toBe(true);
  });
});


describe("discoverPersonas", () => {
  it("clusters duplicate fingerprints into one persona", () => {
    const people = Array.from({ length: 5 }, (_, i) => ({
      personId: `U${i}`,
      usage: fp("a", "b", "c"),
    }));
    const r = discoverPersonas(people, { minSupport: 3 });
    expect(r.personas).toHaveLength(1);
    expect(r.personas[0].support).toBe(5);
    expect(r.exceptions).toEqual([]);
  });

  it("labels small clusters as exceptions, not personas (PRD §8.2)", () => {
    const r = discoverPersonas(
      [
        { personId: "U1", usage: fp("a", "b") },
        { personId: "U2", usage: fp("totally_different_x") },
      ],
      { minSupport: 2 },
    );
    expect(r.personas).toHaveLength(0);
    expect(r.exceptions).toHaveLength(2);
  });

  it("separates two distinct fingerprints into two personas", () => {
    const group_a = Array.from({ length: 4 }, (_, i) => ({
      personId: `A${i}`,
      usage: fp("post:invoice@cc", "display:vendor@cc"),
    }));
    const group_b = Array.from({ length: 4 }, (_, i) => ({
      personId: `B${i}`,
      usage: fp("pay:run@cc", "configure:program@global"),
    }));
    const r = discoverPersonas([...group_a, ...group_b], { minSupport: 3 });
    expect(r.personas).toHaveLength(2);
    expect(r.personas[0].support).toBeGreaterThanOrEqual(3);
    expect(r.personas[1].support).toBeGreaterThanOrEqual(3);
  });

  it("computes a quorum-based representative fingerprint", () => {
    // Five shared atoms + one unique atom per member → pairwise Jaccard 5/7 ≈ 0.714
    // which clears the default 0.7 cluster threshold.
    const r = discoverPersonas(
      [
        { personId: "U1", usage: fp("a", "b", "c", "d", "e", "x1") },
        { personId: "U2", usage: fp("a", "b", "c", "d", "e", "x2") },
        { personId: "U3", usage: fp("a", "b", "c", "d", "e", "x3") },
        { personId: "U4", usage: fp("a", "b", "c", "d", "e") },
      ],
      { minSupport: 3, representativeQuorum: 0.75 },
    );
    expect(r.personas).toHaveLength(1);
    const rep = r.personas[0].representativeFingerprint;
    // a-e all appear in 4/4 members → ≥ 75% quorum.
    ["a", "b", "c", "d", "e"].forEach((atom) => expect(rep.has(atom)).toBe(true));
    // x1/x2/x3 each in 1/4 members → below quorum.
    ["x1", "x2", "x3"].forEach((atom) => expect(rep.has(atom)).toBe(false));
  });

  it("is deterministic across runs", () => {
    const people = [
      { personId: "U1", usage: fp("a", "b") },
      { personId: "U2", usage: fp("a", "b", "c") },
      { personId: "U3", usage: fp("a", "b") },
    ];
    const r1 = discoverPersonas(people, { minSupport: 2 });
    const r2 = discoverPersonas(people, { minSupport: 2 });
    expect(r1).toEqual(r2);
  });

  it("filters out empty-usage people from clustering (no signal)", () => {
    const r = discoverPersonas(
      [
        { personId: "S1", usage: fp() },          // service account — no usage signal
        { personId: "S2", usage: fp() },
        { personId: "U1", usage: fp("a", "b") },
        { personId: "U2", usage: fp("a", "b") },
        { personId: "U3", usage: fp("a", "b") },
      ],
      { minSupport: 3 },
    );
    expect(r.personas).toHaveLength(1);
    expect(r.personas[0].memberIds).toEqual(["U1", "U2", "U3"]);
  });
});
