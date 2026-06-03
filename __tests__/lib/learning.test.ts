import { describe, it, expect, beforeEach } from "vitest";
import {
  buildCorrectionRecord,
  diffEngineVsHuman,
  feedbackToCorrection,
  makeInMemoryCorrectionStore,
  type CanonicalPersonRecordJson,
  type EngineOutput,
  type HumanDecision,
} from "@/lib/learning";

const FAKE_CANONICAL: CanonicalPersonRecordJson = {
  person_id: "P1",
  org_id: "ORG-1",
  attributes: { title: "AP Clerk" },
  source_systems: ["ECC-PROD"],
  entitlement_atom_keys: ["post:vendor_invoice@cc"],
  usage_atom_keys: ["post:vendor_invoice@cc"],
  ground_truth: { persona_id: "P-AP-CLERK" },
  provenance: { schema_version: "1.1.0" },
  meta: {},
};

const ENGINE_GUESS: EngineOutput = {
  personaId: "P-WRONG",
  targetAccessAtomKeys: ["post:vendor_invoice@cc"],
  excessToRemoveAtomKeys: [],
  sodConflictRuleIds: [],
  compositeConfidence: 0.42,
  confidenceComponents: { model: 0.4, overlap: 0.5, history: 0.3 },
  modelVersion: "claude-sonnet-4-5-zs",
  rulePackVersion: "1.0.0",
  datasetVersion: "1.1.0",
};

const HUMAN_RIGHT: HumanDecision = {
  personaId: "P-AP-CLERK",
  targetAccessAtomKeys: ["post:vendor_invoice@cc", "display:vendor_open_items@cc"],
  excessToRemoveAtomKeys: [],
  sodConflictRuleIds: [],
  rationale: "Usage clearly matches AP Clerk; engine missed display:vendor_open_items.",
};

function _mkCorrection() {
  return buildCorrectionRecord({
    canonicalRecord: FAKE_CANONICAL,
    engineOutput: ENGINE_GUESS,
    humanDecision: HUMAN_RIGHT,
    correctorActor: "alice@example.com",
    correctorRole: "security_architect",
    correctedAt: "2026-06-03T10:00:00Z",
    engagementId: "ENG-1",
  });
}


describe("buildCorrectionRecord", () => {
  it("defaults: verification=pending, weight=2.0, anonymization=full", () => {
    const r = _mkCorrection();
    expect(r.correction_metadata.verification_status).toBe("pending");
    expect(r.correction_metadata.weight).toBe(2.0);
    expect(r.correction_metadata.anonymization_level).toBe("full");
  });

  it("preserves all engine output fields including version pins", () => {
    const r = _mkCorrection();
    const eo = r.correction_metadata.engine_output;
    expect(eo.model_version).toBe("claude-sonnet-4-5-zs");
    expect(eo.rule_pack_version).toBe("1.0.0");
    expect(eo.dataset_version).toBe("1.1.0");
    expect(eo.confidence_components).toEqual({ model: 0.4, overlap: 0.5, history: 0.3 });
  });

  it("does not share array references with input (defensive copy)", () => {
    const inputAtoms = ["a", "b"];
    const r = buildCorrectionRecord({
      canonicalRecord: FAKE_CANONICAL,
      engineOutput: { ...ENGINE_GUESS, targetAccessAtomKeys: inputAtoms },
      humanDecision: HUMAN_RIGHT,
      correctorActor: "a", correctorRole: "x", correctedAt: "2026-06-03T10:00:00Z",
    });
    inputAtoms.push("c");
    expect(r.correction_metadata.engine_output.target_access_atom_keys).toEqual(["a", "b"]);
  });
});


describe("diffEngineVsHuman", () => {
  it("flags persona id change + atoms added by the human", () => {
    const r = _mkCorrection();
    const diff = diffEngineVsHuman(r);
    expect(diff.personaIdChanged).toBe(true);
    expect(diff.targetAccessAdded).toEqual(["display:vendor_open_items@cc"]);
    expect(diff.targetAccessRemoved).toEqual([]);
  });

  it("no diff when engine and human agree", () => {
    const r = buildCorrectionRecord({
      canonicalRecord: FAKE_CANONICAL,
      engineOutput: ENGINE_GUESS,
      humanDecision: {
        personaId: "P-WRONG",   // same as engine
        targetAccessAtomKeys: ["post:vendor_invoice@cc"],
        excessToRemoveAtomKeys: [],
        sodConflictRuleIds: [],
        rationale: null,
      },
      correctorActor: "a", correctorRole: "x", correctedAt: "2026-06-03T10:00:00Z",
    });
    const diff = diffEngineVsHuman(r);
    expect(diff.personaIdChanged).toBe(false);
    expect(diff.targetAccessAdded).toEqual([]);
    expect(diff.targetAccessRemoved).toEqual([]);
  });
});


describe("in-memory correction store", () => {
  let store: ReturnType<typeof makeInMemoryCorrectionStore>;
  beforeEach(() => {
    store = makeInMemoryCorrectionStore();
  });

  it("scopes by organization", () => {
    store.add(_mkCorrection(), 1);
    store.add(_mkCorrection(), 2);
    expect(store.size(1)).toBe(1);
    expect(store.size(2)).toBe(1);
    expect(store.size(99)).toBe(0);
  });

  it("verifiedOnly defaults to true and filters pending corrections out", () => {
    store.add(_mkCorrection(), 1); // pending
    expect(store.query({ organizationId: 1 })).toHaveLength(0);
    expect(store.query({ organizationId: 1, verifiedOnly: false })).toHaveLength(1);
  });

  it("returns most-recent first and respects limit", () => {
    const older = buildCorrectionRecord({
      canonicalRecord: FAKE_CANONICAL, engineOutput: ENGINE_GUESS, humanDecision: HUMAN_RIGHT,
      correctorActor: "a", correctorRole: "x", correctedAt: "2026-01-01T00:00:00Z",
      verificationStatus: "verified",
    });
    const newer = buildCorrectionRecord({
      canonicalRecord: FAKE_CANONICAL, engineOutput: ENGINE_GUESS, humanDecision: HUMAN_RIGHT,
      correctorActor: "b", correctorRole: "x", correctedAt: "2026-06-03T00:00:00Z",
      verificationStatus: "verified",
    });
    store.add(older, 1);
    store.add(newer, 1);
    const result = store.query({ organizationId: 1, limit: 5 });
    expect(result).toHaveLength(2);
    expect(result[0].correction_metadata.corrected_at).toBe("2026-06-03T00:00:00Z");
  });

  it("filters by engagementId when provided", () => {
    const eng1 = buildCorrectionRecord({
      canonicalRecord: FAKE_CANONICAL, engineOutput: ENGINE_GUESS, humanDecision: HUMAN_RIGHT,
      correctorActor: "a", correctorRole: "x", correctedAt: "2026-06-03T00:00:00Z",
      verificationStatus: "verified", engagementId: "ENG-A",
    });
    const eng2 = buildCorrectionRecord({
      canonicalRecord: FAKE_CANONICAL, engineOutput: ENGINE_GUESS, humanDecision: HUMAN_RIGHT,
      correctorActor: "a", correctorRole: "x", correctedAt: "2026-06-03T00:00:00Z",
      verificationStatus: "verified", engagementId: "ENG-B",
    });
    store.add(eng1, 1);
    store.add(eng2, 1);
    const result = store.query({ organizationId: 1, engagementId: "ENG-A" });
    expect(result).toHaveLength(1);
    expect(result[0].correction_metadata.engagement_id).toBe("ENG-A");
  });
});


describe("feedbackToCorrection (mapping_feedback wrapper)", () => {
  const snapshot = {
    canonical_record: FAKE_CANONICAL,
    engineOutput: {
      persona_id: "P-AP-CLERK",
      target_access_atom_keys: ["post:vendor_invoice@cc"],
      excess_to_remove_atom_keys: [],
      sod_conflict_rule_ids: [],
      composite_confidence: 0.85,
      confidence_components: null,
      model_version: "claude-sonnet-4-5-zs",
      rule_pack_version: "1.0.0",
      dataset_version: "1.1.0",
    },
  };

  it("accepted row -> weight 1.0, human persona = engine persona", () => {
    const r = feedbackToCorrection({
      id: 1, personaId: 10, targetRoleId: 20, accepted: true, aiConfidence: 85,
      aiReasoning: "good match", createdBy: "mapper@example.com", organizationId: 1,
      createdAt: "2026-06-03T00:00:00Z",
    }, snapshot, { correctorRole: "mapper" });
    expect(r.correction_metadata.weight).toBe(1.0);
    expect(r.correction_metadata.human_decision.persona_id).toBe("P-AP-CLERK");
  });

  it("rejected row -> weight 2.0, human persona = null (engine was wrong)", () => {
    const r = feedbackToCorrection({
      id: 1, personaId: 10, targetRoleId: 20, accepted: false, aiConfidence: 85,
      aiReasoning: "not the right persona", createdBy: "mapper@example.com", organizationId: 1,
      createdAt: "2026-06-03T00:00:00Z",
    }, snapshot, { correctorRole: "mapper" });
    expect(r.correction_metadata.weight).toBe(2.0);
    expect(r.correction_metadata.human_decision.persona_id).toBeNull();
  });
});
