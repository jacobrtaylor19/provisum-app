/**
 * Policy Drift Detection (#42)
 *
 * After a target role is approved, its permission set is snapshotted on the role
 * (`approvedPermissionHash` / `approvedPermissionSnapshot`). This module recomputes
 * a role's current permission set and compares it to that baseline. When they differ,
 * a governance alert is recorded in `securityDesignChanges` (changeType=role_modified,
 * detectedBy="policy_drift") so it surfaces on /risk-analysis and in the existing
 * /admin/security-design review UI (accept/dismiss).
 *
 * Design notes:
 * - Permission set is computed from the DIRECT target_role_permissions → target_permissions
 *   join, matching how lib/sod/sod-analysis.ts expands roles, so drift is measured on the
 *   same basis the SOD engine uses.
 * - First scan establishes a baseline for any active role missing one (no alert on baseline).
 * - Strictly idempotent: an existing PENDING policy_drift alert for a role is refreshed in
 *   place rather than duplicated.
 * - Org-scoped throughout.
 */

import { createHash } from "crypto";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";

export interface PolicyDriftResult {
  rolesChecked: number;
  baselinesEstablished: number;
  driftsFound: number;
  alertsCreated: number;
  alertsRefreshed: number;
}

/** Stable sha256 over a permission-id set (order-independent). */
export function hashPermissionSet(permissionIds: string[]): string {
  const sorted = Array.from(new Set(permissionIds)).sort();
  return createHash("sha256").update(sorted.join("\n")).digest("hex");
}

/**
 * Current permission set for a single role (direct target_role_permissions join),
 * returned as a sorted, de-duplicated permissionId array.
 */
export async function computeRolePermissionSet(roleId: number): Promise<string[]> {
  const rows = await db
    .select({ permissionId: schema.targetPermissions.permissionId })
    .from(schema.targetRolePermissions)
    .innerJoin(
      schema.targetPermissions,
      eq(schema.targetRolePermissions.targetPermissionId, schema.targetPermissions.id),
    )
    .where(eq(schema.targetRolePermissions.targetRoleId, roleId));
  return Array.from(new Set(rows.map((r) => r.permissionId))).sort();
}

/**
 * Compute the approval-time baseline for a role. Caller persists the returned values
 * onto target_roles (used by the approve route).
 */
export async function captureApprovalSnapshot(
  roleId: number,
): Promise<{ hash: string; snapshot: string }> {
  const perms = await computeRolePermissionSet(roleId);
  return { hash: hashPermissionSet(perms), snapshot: JSON.stringify(perms) };
}

/** Diff two permission-id sets into added/removed. */
export function diffPermissions(
  baseline: string[],
  current: string[],
): { added: string[]; removed: string[] } {
  const baseSet = new Set(baseline);
  const curSet = new Set(current);
  return {
    added: current.filter((p) => !baseSet.has(p)),
    removed: baseline.filter((p) => !curSet.has(p)),
  };
}

/**
 * Detect policy drift across all ACTIVE target roles in an organization.
 * - Active roles with no baseline get one (no alert on first pass).
 * - Active roles whose current permission set differs from the baseline produce a
 *   role_modified governance alert (deduped against an existing pending alert).
 */
export async function detectPolicyDrift(orgId: number): Promise<PolicyDriftResult> {
  const result: PolicyDriftResult = {
    rolesChecked: 0,
    baselinesEstablished: 0,
    driftsFound: 0,
    alertsCreated: 0,
    alertsRefreshed: 0,
  };

  const activeRoles = await db
    .select()
    .from(schema.targetRoles)
    .where(
      and(
        eq(schema.targetRoles.organizationId, orgId),
        eq(schema.targetRoles.status, "active"),
      ),
    );

  if (activeRoles.length === 0) return result;

  // Existing pending policy-drift alerts for this org, keyed by targetRoleId (for dedup).
  const pendingAlerts = await db
    .select({
      id: schema.securityDesignChanges.id,
      targetRoleId: schema.securityDesignChanges.targetRoleId,
    })
    .from(schema.securityDesignChanges)
    .where(
      and(
        eq(schema.securityDesignChanges.organizationId, orgId),
        eq(schema.securityDesignChanges.status, "pending"),
        eq(schema.securityDesignChanges.detectedBy, "policy_drift"),
      ),
    );
  const pendingByRole = new Map<number, number>();
  for (const a of pendingAlerts) {
    if (a.targetRoleId != null) pendingByRole.set(a.targetRoleId, a.id);
  }

  for (const role of activeRoles) {
    result.rolesChecked++;
    const current = await computeRolePermissionSet(role.id);
    const currentHash = hashPermissionSet(current);

    // No baseline yet → establish one, never alert on the first observation.
    if (!role.approvedPermissionHash) {
      await db
        .update(schema.targetRoles)
        .set({
          approvedPermissionHash: currentHash,
          approvedPermissionSnapshot: JSON.stringify(current),
        })
        .where(eq(schema.targetRoles.id, role.id));
      result.baselinesEstablished++;
      continue;
    }

    // Hash match → no drift.
    if (role.approvedPermissionHash === currentHash) continue;

    // Drift detected.
    result.driftsFound++;
    let baseline: string[] = [];
    try {
      baseline = role.approvedPermissionSnapshot
        ? (JSON.parse(role.approvedPermissionSnapshot) as string[])
        : [];
    } catch {
      baseline = [];
    }
    const { added, removed } = diffPermissions(baseline, current);

    const detailParts: string[] = [];
    if (added.length) detailParts.push(`+${added.length} added (${added.slice(0, 10).join(", ")}${added.length > 10 ? "…" : ""})`);
    if (removed.length) detailParts.push(`-${removed.length} removed (${removed.slice(0, 10).join(", ")}${removed.length > 10 ? "…" : ""})`);
    const detail = `Permission set changed since approval: ${detailParts.join("; ") || "membership reordered"}.`;

    // affectedMappingCount = assignments referencing this role.
    const assignments = await db
      .select({ id: schema.userTargetRoleAssignments.id })
      .from(schema.userTargetRoleAssignments)
      .where(eq(schema.userTargetRoleAssignments.targetRoleId, role.id));
    const affected = assignments.length;

    const existingId = pendingByRole.get(role.id);
    if (existingId) {
      // Refresh the open alert in place (idempotent re-run).
      await db
        .update(schema.securityDesignChanges)
        .set({
          detail,
          changeDescription: detail,
          affectedMappingCount: affected,
          detectedAt: new Date().toISOString(),
        })
        .where(eq(schema.securityDesignChanges.id, existingId));
      result.alertsRefreshed++;
    } else {
      await db.insert(schema.securityDesignChanges).values({
        targetRoleId: role.id,
        changeType: "role_modified",
        roleName: role.roleName,
        roleExternalId: role.roleId,
        detail,
        changeDescription: detail,
        status: "pending",
        detectedBy: "policy_drift",
        affectedMappingCount: affected,
        organizationId: orgId,
      });
      result.alertsCreated++;
    }
  }

  return result;
}

/**
 * Pending policy-drift governance alerts for an org, for read-only surfacing
 * (e.g. the Policy Drift card on /risk-analysis).
 */
export async function getPendingPolicyDrift(orgId: number) {
  return db
    .select({
      id: schema.securityDesignChanges.id,
      targetRoleId: schema.securityDesignChanges.targetRoleId,
      roleName: schema.securityDesignChanges.roleName,
      roleExternalId: schema.securityDesignChanges.roleExternalId,
      detail: schema.securityDesignChanges.detail,
      affectedMappingCount: schema.securityDesignChanges.affectedMappingCount,
      detectedAt: schema.securityDesignChanges.detectedAt,
    })
    .from(schema.securityDesignChanges)
    .where(
      and(
        eq(schema.securityDesignChanges.organizationId, orgId),
        eq(schema.securityDesignChanges.status, "pending"),
        eq(schema.securityDesignChanges.detectedBy, "policy_drift"),
      ),
    );
}
