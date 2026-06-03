/**
 * In-session correction retrieval (PRD §11, §14).
 *
 * "Retrieval gives the engine same-session memory of a mapper's confirmed
 * decisions." Within an engagement, verified corrections reach the reasoning
 * model immediately via this retrieval path — no retrain needed.
 *
 * Phase 1 implementation: in-memory store keyed by org. The DB-backed version
 * lands when the wire-up between `mapping_feedback` rows and `CorrectionRecord`
 * JSONL completes (gated on B2 fine-tune availability).
 */

import type { CorrectionRecord } from "./correction-record";

export interface CorrectionRetrievalQuery {
  organizationId: number;
  personaId?: string;
  /** Optional: filter by engagement (project) within an org. */
  engagementId?: string;
  /** Max records to return; default 10. */
  limit?: number;
  /** Default true. False to include pending corrections too. */
  verifiedOnly?: boolean;
}

export interface CorrectionStore {
  add(record: CorrectionRecord, organizationId: number): void;
  query(q: CorrectionRetrievalQuery): CorrectionRecord[];
  size(organizationId: number): number;
  clear(): void;
}

/** In-memory store. Process-local; not durable across restarts. */
export function makeInMemoryCorrectionStore(): CorrectionStore {
  const byOrg = new Map<number, CorrectionRecord[]>();

  return {
    add(record, organizationId) {
      let bucket = byOrg.get(organizationId);
      if (!bucket) {
        bucket = [];
        byOrg.set(organizationId, bucket);
      }
      bucket.push(record);
    },

    query(q) {
      const bucket = byOrg.get(q.organizationId) ?? [];
      const limit = q.limit ?? 10;
      const verifiedOnly = q.verifiedOnly ?? true;
      const filtered = bucket.filter((r) => {
        const m = r.correction_metadata;
        if (verifiedOnly && m.verification_status !== "verified") return false;
        if (q.engagementId && m.engagement_id !== q.engagementId) return false;
        if (q.personaId && m.human_decision.persona_id !== q.personaId) return false;
        return true;
      });
      // Most recent first (corrected_at is ISO-8601 lexicographically sortable).
      filtered.sort((a, b) =>
        b.correction_metadata.corrected_at.localeCompare(a.correction_metadata.corrected_at),
      );
      return filtered.slice(0, limit);
    },

    size(organizationId) {
      return byOrg.get(organizationId)?.length ?? 0;
    },

    clear() {
      byOrg.clear();
    },
  };
}

/**
 * Map existing `mapping_feedback` rows to CorrectionRecord shape.
 *
 * `mapping_feedback` (live in production today) captures (personaId, targetRoleId,
 * accepted) decisions. To wrap one in a CorrectionRecord we need the canonical
 * record from the engine's view at decision time and the engine's recorded output.
 *
 * Phase 1: the legacy `mapping_feedback` columns don't yet carry the canonical
 * record snapshot. This function is the SHAPE that the future migration must
 * produce; it is referenced by docs/strategy when planning the migration.
 *
 * NOTE: deliberately not wired to the DB in B4. Wiring requires a schema
 * extension on `mapping_feedback` (to carry the canonical snapshot) which
 * needs a `pnpm db:push` — that's a coordinated migration, not autonomous work.
 */
export interface MappingFeedbackRow {
  id: number;
  personaId: number;
  targetRoleId: number;
  accepted: boolean;
  aiConfidence: number;
  aiReasoning: string | null;
  createdBy: string;
  organizationId: number;
  createdAt: string;
}

export interface CanonicalSnapshot {
  canonical_record: CorrectionRecord["canonical_record"];
  engineOutput: CorrectionRecord["correction_metadata"]["engine_output"];
}

/**
 * Wrap a `mapping_feedback` row + a canonical snapshot into a CorrectionRecord.
 *
 * Engine PRD §14 promote path: corrections are anonymized + verified before
 * folding into the training pool. This function does the SHAPING; verification
 * is a separate workflow.
 */
export function feedbackToCorrection(
  row: MappingFeedbackRow,
  snapshot: CanonicalSnapshot,
  options: {
    correctorRole: string;
    verificationStatus?: "pending" | "verified";
    weight?: number;
    engagementId?: string;
  },
): CorrectionRecord {
  const enginePersonaId = snapshot.engineOutput.persona_id;
  // For a REJECTED suggestion, the human's "right answer" differs from the engine's.
  // For an ACCEPTED suggestion, the engine got it right — this is positive evidence,
  // not a correction per se; we still record it with weight 1.0 and a null change.
  return {
    canonical_record: snapshot.canonical_record,
    correction_metadata: {
      engine_output: snapshot.engineOutput,
      human_decision: {
        persona_id: row.accepted ? enginePersonaId : null, // null = "engine was wrong, no specific replacement recorded"
        target_access_atom_keys: row.accepted ? snapshot.engineOutput.target_access_atom_keys : [],
        excess_to_remove_atom_keys: row.accepted ? snapshot.engineOutput.excess_to_remove_atom_keys : [],
        sod_conflict_rule_ids: row.accepted ? snapshot.engineOutput.sod_conflict_rule_ids : [],
        rationale: row.aiReasoning,
      },
      corrector_actor: row.createdBy,
      corrector_role: options.correctorRole,
      corrected_at: row.createdAt,
      verification_status: options.verificationStatus ?? "pending",
      // Accepted suggestions get neutral weight (1.0) since they're not "hard corrections."
      // Rejected suggestions are corrections — default 2.0 above synthetic.
      weight: options.weight ?? (row.accepted ? 1.0 : 2.0),
      anonymization_level: "full",
      engagement_id: options.engagementId ?? null,
      correction_schema_version: "1.0.0",
    },
  };
}
