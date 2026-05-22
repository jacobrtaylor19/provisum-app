import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq, desc } from "drizzle-orm";

// ─────────────────────────────────────────────
// POINT-IN-TIME HISTORY QUERY HELPER (A1.2)
//
// The three history tables (user_persona_assignments_history,
// persona_target_role_mappings_history, sod_conflicts_history) capture
// a full row snapshot on every INSERT, UPDATE, and DELETE via Postgres triggers.
//
// Use getStateAsOf() to answer: "What was the state of row X at timestamp Y?"
// This is the foundation for audit reproducibility: an auditor can ask
// "What roles was user 42 assigned to at go-live on 2026-06-01?"
//
// The returned value is the parsed JSON snapshot — same shape as the live row.
// Returns null if no history exists before asOfTimestamp (row didn't exist yet).
// ─────────────────────────────────────────────

export type HistoryTable =
  | "userPersonaAssignments"
  | "personaTargetRoleMappings"
  | "sodConflicts";

export interface HistoryRow {
  id: string; // uuid
  originalRowId: number;
  orgId: number;
  snapshotJson: string;
  changedBy: string;
  changedAt: string;
  changeKind: "insert" | "update" | "delete";
}

/**
 * Retrieve the state of a specific row at or before a given timestamp.
 *
 * @param table        Which evidence-persistent table to query history for.
 * @param rowId        The `id` of the live-table row (original_row_id in history).
 * @param asOfTimestamp  ISO 8601 timestamp (inclusive upper bound).
 * @returns            Parsed snapshot object, or null if no history found.
 */
export async function getStateAsOf(
  table: HistoryTable,
  rowId: number,
  asOfTimestamp: string,
): Promise<Record<string, unknown> | null> {
  const historyTable = resolveHistoryTable(table);

  const rows = await db
    .select()
    .from(historyTable)
    .where(eq(historyTable.originalRowId, rowId))
    // Find the most recent history row at or before the requested timestamp
    .orderBy(desc(historyTable.changedAt))
    .limit(50); // reasonable cap; snapshots are compact

  // Filter in JS since changedAt is a text column (ISO string comparison works lexicographically)
  const candidate = rows.find((r) => r.changedAt <= asOfTimestamp);
  if (!candidate) return null;

  // If the most recent action before asOf was a DELETE, the row didn't exist at that time
  if (candidate.changeKind === "delete") return null;

  try {
    return JSON.parse(candidate.snapshotJson) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Retrieve the full change history for a specific row, newest first.
 */
export async function getFullHistory(
  table: HistoryTable,
  rowId: number,
): Promise<HistoryRow[]> {
  const historyTable = resolveHistoryTable(table);
  const rows = await db
    .select()
    .from(historyTable)
    .where(eq(historyTable.originalRowId, rowId))
    .orderBy(desc(historyTable.changedAt));

  return rows.map((r) => ({
    id: r.id,
    originalRowId: r.originalRowId,
    orgId: r.orgId,
    snapshotJson: r.snapshotJson,
    changedBy: r.changedBy,
    changedAt: r.changedAt,
    changeKind: r.changeKind as HistoryRow["changeKind"],
  }));
}

// ─────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────

function resolveHistoryTable(table: HistoryTable) {
  switch (table) {
    case "userPersonaAssignments":
      return schema.userPersonaAssignmentsHistory;
    case "personaTargetRoleMappings":
      return schema.personaTargetRoleMappingsHistory;
    case "sodConflicts":
      return schema.sodConflictsHistory;
  }
}
