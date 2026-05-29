/**
 * Continuous SOD Monitoring (#43)
 *
 * Re-evaluates segregation-of-duties rules against an organization's *live* access
 * (approved current-wave assignments + existing/production-phase assignments) on a
 * schedule — not just during the initial migration wave. Newly-introduced conflicts
 * (a post-approval role/permission change or a new approval that creates a violation
 * which is NOT already an open SOD conflict from the migration workflow) are surfaced
 * as incidents in /admin/incidents with AI triage.
 *
 * Why a separate path from runSodAnalysis():
 * - runSodAnalysis() MUTATES assignment statuses and deletes/recreates sodConflicts for
 *   the analyzed users. That is correct for the migration wave but unsafe for live
 *   monitoring. This scan is STRICTLY READ-ONLY over assignments/conflicts: it never
 *   flips an approved assignment back to sod_rejected and never rewrites sodConflicts.
 *   Detected drift is surfaced as an incident for a human to triage (aligns with #30
 *   auto-remediation being deferred).
 *
 * Idempotency:
 * - A conflict that already exists as an OPEN sodConflict (known from the migration
 *   workflow) is excluded — we only raise genuinely new conflicts.
 * - Incidents are deduped by source+sourceRef ("sod:<orgId>:<userId>:<ruleId>"), so
 *   re-running the weekly scan does not create duplicates.
 */

import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq, and, or, inArray } from "drizzle-orm";
import { detectIncident } from "@/lib/incidents/detection";

export interface ContinuousSodResult {
  usersScanned: number;
  liveAssignments: number;
  conflictsEvaluated: number;
  newConflicts: number;
  incidentsRaised: number;
}

type Severity = "critical" | "high" | "medium" | "low";

export function toIncidentSeverity(ruleSeverity: string): Severity {
  switch (ruleSeverity) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "low":
      return "low";
    default:
      return "medium";
  }
}

/**
 * Run a read-only SOD scan over an organization's live access and raise incidents for
 * newly-introduced conflicts. Does not modify assignments or sodConflicts.
 */
export async function runContinuousSodScan(orgId: number): Promise<ContinuousSodResult> {
  const result: ContinuousSodResult = {
    usersScanned: 0,
    liveAssignments: 0,
    conflictsEvaluated: 0,
    newConflicts: 0,
    incidentsRaised: 0,
  };

  // 1. Active SOD rules for this org.
  const rules = await db
    .select()
    .from(schema.sodRules)
    .where(and(eq(schema.sodRules.organizationId, orgId), eq(schema.sodRules.isActive, true)));
  if (rules.length === 0) return result;

  // 2. Live assignments for this org: approved (final) OR existing-phase (production access).
  //    Assignments are org-scoped via their user (users.organizationId).
  const liveAssignments = await db
    .select({
      userId: schema.userTargetRoleAssignments.userId,
      targetRoleId: schema.userTargetRoleAssignments.targetRoleId,
    })
    .from(schema.userTargetRoleAssignments)
    .innerJoin(schema.users, eq(schema.userTargetRoleAssignments.userId, schema.users.id))
    .where(
      and(
        eq(schema.users.organizationId, orgId),
        or(
          eq(schema.userTargetRoleAssignments.status, "approved"),
          eq(schema.userTargetRoleAssignments.releasePhase, "existing"),
        ),
      ),
    );
  result.liveAssignments = liveAssignments.length;
  if (liveAssignments.length === 0) return result;

  // 3. Group roles by user.
  const userRoles = new Map<number, Set<number>>();
  for (const a of liveAssignments) {
    if (!userRoles.has(a.userId)) userRoles.set(a.userId, new Set());
    userRoles.get(a.userId)!.add(a.targetRoleId);
  }
  result.usersScanned = userRoles.size;

  // 4. Expand every referenced role to its direct permission set (matches sod-analysis).
  const allRoleIds = Array.from(new Set(liveAssignments.map((a) => a.targetRoleId)));
  const rolePerms = new Map<number, Set<string>>();
  if (allRoleIds.length > 0) {
    const trps = await db
      .select({
        roleId: schema.targetRolePermissions.targetRoleId,
        permissionId: schema.targetPermissions.permissionId,
      })
      .from(schema.targetRolePermissions)
      .innerJoin(
        schema.targetPermissions,
        eq(schema.targetRolePermissions.targetPermissionId, schema.targetPermissions.id),
      )
      .where(inArray(schema.targetRolePermissions.targetRoleId, allRoleIds));
    for (const row of trps) {
      if (!rolePerms.has(row.roleId)) rolePerms.set(row.roleId, new Set());
      rolePerms.get(row.roleId)!.add(row.permissionId);
    }
  }

  // 5. Existing OPEN sodConflicts for the scanned users → exclude already-known conflicts.
  const scannedUserIds = Array.from(userRoles.keys());
  const openConflicts = await db
    .select({
      userId: schema.sodConflicts.userId,
      sodRuleId: schema.sodConflicts.sodRuleId,
    })
    .from(schema.sodConflicts)
    .where(
      and(
        inArray(schema.sodConflicts.userId, scannedUserIds),
        eq(schema.sodConflicts.resolutionStatus, "open"),
      ),
    );
  const knownOpen = new Set(openConflicts.map((c) => `${c.userId}:${c.sodRuleId}`));

  // 6. Evaluate rules per user; raise an incident for each genuinely-new conflict.
  for (const [userId, roleIds] of Array.from(userRoles.entries())) {
    const userPerms = new Set<string>();
    for (const roleId of Array.from(roleIds)) {
      const perms = rolePerms.get(roleId);
      if (perms) Array.from(perms).forEach((p) => userPerms.add(p));
    }

    for (const rule of rules) {
      if (userPerms.has(rule.permissionA) && userPerms.has(rule.permissionB)) {
        result.conflictsEvaluated++;
        const key = `${userId}:${rule.id}`;
        if (knownOpen.has(key)) continue; // already tracked in the migration workflow
        result.newConflicts++;

        const incidentId = await detectIncident({
          title: `New SOD conflict on live access: ${rule.ruleName}`,
          description:
            `Continuous monitoring detected a segregation-of-duties violation on live ` +
            `(approved/production) access. User #${userId} now holds both "${rule.permissionA}" ` +
            `and "${rule.permissionB}" via approved roles, matching SOD rule "${rule.ruleName}". ` +
            `This conflict was not present in the migration-time analysis. Review and remediate.`,
          severity: toIncidentSeverity(rule.severity),
          source: "sod_monitor",
          sourceRef: `sod:${orgId}:${userId}:${rule.id}`,
          affectedComponent: "sod",
          affectedUsers: 1,
          organizationId: orgId,
          metadata: {
            userId,
            sodRuleId: rule.id,
            ruleName: rule.ruleName,
            permissionA: rule.permissionA,
            permissionB: rule.permissionB,
          },
        });
        if (incidentId > 0) result.incidentsRaised++;
      }
    }
  }

  return result;
}
