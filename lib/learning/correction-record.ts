/**
 * TS mirror of `ml/v2/io/correction_record.py` — the A5 schema (PRD §14).
 *
 * The engine emits these when a human corrects an engine output. They round-trip
 * through JSONL identically to the Python side, so the training pipeline (Python)
 * and the engine (TS) share one source of truth for what a correction looks like.
 *
 * Phase-relevant facts:
 * - LIVE data today: the `mapping_feedback` table (accept/reject on AI mapping
 *   suggestions). That table is the operational source for now.
 * - This module defines the FUTURE-STATE wrapping shape. The wire-up from
 *   `mapping_feedback` rows to `CorrectionRecord` JSONL is the final B4 step
 *   that needs the fine-tune (B2) pipeline to be ready to consume it.
 * - In-session retrieval (PRD §14 "Within an engagement they also reach the
 *   reasoning model immediately through retrieval") is the other consumer; it
 *   reads CorrectionRecord shape via `correction-reader.ts`.
 */

export type VerificationStatus = "pending" | "verified" | "rejected";

export interface EngineOutput {
  personaId: string | null;
  targetAccessAtomKeys: string[];
  excessToRemoveAtomKeys: string[];
  sodConflictRuleIds: string[];
  compositeConfidence: number | null;
  confidenceComponents: Record<string, number> | null;
  modelVersion: string;
  rulePackVersion: string;
  datasetVersion: string;
}

export interface HumanDecision {
  personaId: string | null;
  targetAccessAtomKeys: string[];
  excessToRemoveAtomKeys: string[];
  sodConflictRuleIds: string[];
  rationale: string | null;
}

/** Mirror of the Python `CanonicalPersonRecord.to_jsonable()` shape. */
export interface CanonicalPersonRecordJson {
  person_id: string;
  org_id: string;
  attributes: Record<string, unknown>;
  source_systems: string[];
  entitlement_atom_keys: string[];
  usage_atom_keys: string[];
  ground_truth: Record<string, unknown>;
  provenance: Record<string, unknown>;
  meta: Record<string, unknown>;
}

export interface CorrectionRecord {
  canonical_record: CanonicalPersonRecordJson;
  correction_metadata: {
    engine_output: {
      persona_id: string | null;
      target_access_atom_keys: string[];
      excess_to_remove_atom_keys: string[];
      sod_conflict_rule_ids: string[];
      composite_confidence: number | null;
      confidence_components: Record<string, number> | null;
      model_version: string;
      rule_pack_version: string;
      dataset_version: string;
    };
    human_decision: {
      persona_id: string | null;
      target_access_atom_keys: string[];
      excess_to_remove_atom_keys: string[];
      sod_conflict_rule_ids: string[];
      rationale: string | null;
    };
    corrector_actor: string;
    corrector_role: string;
    corrected_at: string;            // ISO-8601
    verification_status: VerificationStatus;
    weight: number;                  // PRD §14: ≥ 1.0; default 2.0 (above synthetic)
    anonymization_level: "full" | "pseudonymized" | "na";
    engagement_id: string | null;
    correction_schema_version: string;
  };
}

export const CORRECTION_SCHEMA_VERSION = "1.0.0";

export interface BuildCorrectionInput {
  canonicalRecord: CanonicalPersonRecordJson;
  engineOutput: EngineOutput;
  humanDecision: HumanDecision;
  correctorActor: string;
  correctorRole: string;
  correctedAt: string;
  verificationStatus?: VerificationStatus;
  weight?: number;
  anonymizationLevel?: "full" | "pseudonymized" | "na";
  engagementId?: string | null;
}

export function buildCorrectionRecord(input: BuildCorrectionInput): CorrectionRecord {
  return {
    canonical_record: input.canonicalRecord,
    correction_metadata: {
      engine_output: {
        persona_id: input.engineOutput.personaId,
        target_access_atom_keys: [...input.engineOutput.targetAccessAtomKeys],
        excess_to_remove_atom_keys: [...input.engineOutput.excessToRemoveAtomKeys],
        sod_conflict_rule_ids: [...input.engineOutput.sodConflictRuleIds],
        composite_confidence: input.engineOutput.compositeConfidence,
        confidence_components: input.engineOutput.confidenceComponents
          ? { ...input.engineOutput.confidenceComponents }
          : null,
        model_version: input.engineOutput.modelVersion,
        rule_pack_version: input.engineOutput.rulePackVersion,
        dataset_version: input.engineOutput.datasetVersion,
      },
      human_decision: {
        persona_id: input.humanDecision.personaId,
        target_access_atom_keys: [...input.humanDecision.targetAccessAtomKeys],
        excess_to_remove_atom_keys: [...input.humanDecision.excessToRemoveAtomKeys],
        sod_conflict_rule_ids: [...input.humanDecision.sodConflictRuleIds],
        rationale: input.humanDecision.rationale,
      },
      corrector_actor: input.correctorActor,
      corrector_role: input.correctorRole,
      corrected_at: input.correctedAt,
      verification_status: input.verificationStatus ?? "pending",
      weight: input.weight ?? 2.0,
      anonymization_level: input.anonymizationLevel ?? "full",
      engagement_id: input.engagementId ?? null,
      correction_schema_version: CORRECTION_SCHEMA_VERSION,
    },
  };
}

/** Per PRD §14 diff helper. Drives the failure-mining workstream (PRD §15.3 P2). */
export function diffEngineVsHuman(record: CorrectionRecord): {
  personaIdChanged: boolean;
  targetAccessAdded: string[];
  targetAccessRemoved: string[];
  excessAdded: string[];
  excessRemoved: string[];
  sodAdded: string[];
  sodRemoved: string[];
} {
  const eo = record.correction_metadata.engine_output;
  const hd = record.correction_metadata.human_decision;
  const diff = (a: string[], b: string[]) => {
    const sb = new Set(b);
    return a.filter((x) => !sb.has(x)).sort();
  };
  return {
    personaIdChanged: eo.persona_id !== hd.persona_id,
    targetAccessAdded: diff(hd.target_access_atom_keys, eo.target_access_atom_keys),
    targetAccessRemoved: diff(eo.target_access_atom_keys, hd.target_access_atom_keys),
    excessAdded: diff(hd.excess_to_remove_atom_keys, eo.excess_to_remove_atom_keys),
    excessRemoved: diff(eo.excess_to_remove_atom_keys, hd.excess_to_remove_atom_keys),
    sodAdded: diff(hd.sod_conflict_rule_ids, eo.sod_conflict_rule_ids),
    sodRemoved: diff(eo.sod_conflict_rule_ids, hd.sod_conflict_rule_ids),
  };
}
