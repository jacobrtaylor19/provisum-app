import { createHash } from "node:crypto";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

// ─────────────────────────────────────────────
// INTEGRITY HASH PRIMITIVE
// ─────────────────────────────────────────────
//
// Computes a SHA-256 hash of any export payload and optionally persists it
// on the associated run record. This enables downstream verification that
// a file received by an auditor is byte-for-byte identical to what Provisum
// generated — the foundation for the /verify feature (Phase A2+).
//
// Usage:
//   const result = emitIntegrityHash(buffer);
//   // -> { hash: "a3f8...", algorithm: "sha256", emittedAt: Date }
//
//   const result = await emitIntegrityHash(buffer, evidenceRunId);
//   // -> same, AND writes hash to evidence_package_runs.hash
//
// See: lib/webhooks.ts for the HMAC-SHA256 signing pattern (non-keyed
// variant used here since the hash is a content digest, not an auth token).
// ─────────────────────────────────────────────

export interface IntegrityHashResult {
  hash: string;
  algorithm: "sha256";
  emittedAt: Date;
}

/**
 * Compute a SHA-256 content digest of the given payload.
 *
 * If `runRecordId` is provided, the hash is also persisted on the
 * `evidence_package_runs` row so it can be retrieved for verification.
 *
 * @param payload  The export content to hash (Buffer or string).
 * @param runRecordId  Optional evidence_package_runs.id to persist the hash on.
 * @returns  { hash, algorithm, emittedAt }
 */
export async function emitIntegrityHash(
  payload: Buffer | string,
  runRecordId?: number,
): Promise<IntegrityHashResult> {
  const hash = createHash("sha256")
    .update(payload)
    .digest("hex");

  const result: IntegrityHashResult = {
    hash,
    algorithm: "sha256",
    emittedAt: new Date(),
  };

  if (runRecordId !== undefined) {
    try {
      await db
        .update(schema.evidencePackageRuns)
        .set({ hash })
        .where(eq(schema.evidencePackageRuns.id, runRecordId));
    } catch (err) {
      // Hash persistence failure should never block the export response.
      // Log and continue; the hash is still returned to the caller.
      console.error("[integrity] Failed to persist hash on run record", {
        runRecordId,
        err,
      });
    }
  }

  return result;
}

/**
 * Compute a SHA-256 digest synchronously (no DB write).
 * Use this in tests or contexts where async is not available.
 */
export function computeHash(payload: Buffer | string): string {
  return createHash("sha256").update(payload).digest("hex");
}
