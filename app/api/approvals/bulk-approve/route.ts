import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth";
import { safeError } from "@/lib/errors";
import { auditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (user.role === "viewer") {
      return NextResponse.json({ error: "Insufficient permissions. Viewer role cannot approve assignments." }, { status: 403 });
    }

    // Try to parse body — may be empty for legacy bulk approve
    let body: { department?: string; assignmentIds?: number[] } = {};
    try {
      const text = await request.text();
      if (text.trim()) {
        body = JSON.parse(text);
      }
    } catch {
      // Empty body is fine — legacy bulk approve
    }

    const { department, assignmentIds } = body;

    if (department) {
      // Department-based bulk approve
      return handleDepartmentApprove(department, user.email || user.username, user.organizationId);
    } else if (assignmentIds && Array.isArray(assignmentIds) && assignmentIds.length > 0) {
      // ID-based bulk approve
      return handleIdsApprove(assignmentIds, user.email || user.username, user.organizationId);
    } else {
      // Legacy: approve all high-confidence ready_for_approval
      return handleLegacyBulkApprove(user.email || user.username, user.organizationId);
    }
  } catch (err: unknown) {
    const message = safeError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Approve all eligible assignments for a specific department */
async function handleDepartmentApprove(department: string, actorEmail: string, orgId: number) {
  // Get all assignments for users in this department with approvable status
  const approvableStatuses = ["ready_for_approval", "compliance_approved"];

  const candidates = await db
    .select({
      assignmentId: schema.userTargetRoleAssignments.id,
      userId: schema.userTargetRoleAssignments.userId,
      status: schema.userTargetRoleAssignments.status,
      sodConflictCount: schema.userTargetRoleAssignments.sodConflictCount,
      riskAcceptedBy: schema.userTargetRoleAssignments.riskAcceptedBy,
      department: schema.users.department,
    })
    .from(schema.userTargetRoleAssignments)
    .innerJoin(schema.users, eq(schema.users.id, schema.userTargetRoleAssignments.userId))
    .where(eq(schema.users.department, department));

  // Filter to only approvable statuses
  const eligible = candidates.filter((c) => {
    if (!approvableStatuses.includes(c.status)) return false;
    // Skip assignments with SOD conflicts unless risk has been accepted
    if ((c.sodConflictCount ?? 0) > 0 && !c.riskAcceptedBy) return false;
    return true;
  });

  // Also include sod_risk_accepted assignments
  const riskAccepted = candidates.filter((c) => c.status === "sod_risk_accepted");
  const allEligible = [...eligible, ...riskAccepted];

  const now = new Date().toISOString();
  let count = 0;

  for (const item of allEligible) {
    await db.update(schema.userTargetRoleAssignments)
      .set({
        status: "approved",
        approvedBy: actorEmail,
        approvedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.userTargetRoleAssignments.id, item.assignmentId));
    count++;
  }

  const skippedSod = candidates.filter(
    (c) => approvableStatuses.includes(c.status) && (c.sodConflictCount ?? 0) > 0 && !c.riskAcceptedBy
  ).length;

  if (count > 0) {
    await auditLog({
      organizationId: orgId,
      entityType: "userTargetRoleAssignment",
      entityId: 0,
      action: "bulk_approved",
      actorEmail,
      newValue: JSON.stringify({ count, department, skippedSod }),
    });
  }

  return NextResponse.json({ success: true, count, skippedSod, department });
}

/** Approve specific assignment IDs */
async function handleIdsApprove(assignmentIds: number[], actorEmail: string, orgId: number) {
  const approvableStatuses = ["ready_for_approval", "compliance_approved", "sod_risk_accepted"];
  const now = new Date().toISOString();
  let count = 0;
  let skippedSod = 0;

  for (const id of assignmentIds) {
    const [assignment] = await db
      .select({
        id: schema.userTargetRoleAssignments.id,
        status: schema.userTargetRoleAssignments.status,
        sodConflictCount: schema.userTargetRoleAssignments.sodConflictCount,
        riskAcceptedBy: schema.userTargetRoleAssignments.riskAcceptedBy,
      })
      .from(schema.userTargetRoleAssignments)
      .where(eq(schema.userTargetRoleAssignments.id, id))
      .limit(1);

    if (!assignment || !approvableStatuses.includes(assignment.status)) continue;

    // Skip SOD conflicts without risk acceptance
    if ((assignment.sodConflictCount ?? 0) > 0 && !assignment.riskAcceptedBy) {
      skippedSod++;
      continue;
    }

    await db.update(schema.userTargetRoleAssignments)
      .set({
        status: "approved",
        approvedBy: actorEmail,
        approvedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.userTargetRoleAssignments.id, id));
    count++;
  }

  if (count > 0) {
    await auditLog({
      organizationId: orgId,
      entityType: "userTargetRoleAssignment",
      entityId: 0,
      action: "bulk_approved",
      actorEmail,
      newValue: JSON.stringify({ count, assignmentIds, skippedSod }),
    });
  }

  return NextResponse.json({ success: true, count, skippedSod });
}

/** Legacy: approve all ready_for_approval with high confidence */
async function handleLegacyBulkApprove(actorEmail: string, orgId: number) {
  const candidates = await db.select({
    assignmentId: schema.userTargetRoleAssignments.id,
    userId: schema.userTargetRoleAssignments.userId,
    confidence: sql<number | null>`(
      SELECT upa.confidence_score
      FROM user_persona_assignments upa
      WHERE upa.user_id = user_target_role_assignments.user_id
      LIMIT 1
    )`,
  }).from(schema.userTargetRoleAssignments)
    .where(eq(schema.userTargetRoleAssignments.status, "ready_for_approval"));

  const highConfidence = candidates.filter(c => c.confidence !== null && c.confidence >= 85);

  let count = 0;
  const now = new Date().toISOString();
  for (const candidate of highConfidence) {
    await db.update(schema.userTargetRoleAssignments).set({
      status: "approved",
      approvedBy: actorEmail,
      approvedAt: now,
      updatedAt: now,
    }).where(eq(schema.userTargetRoleAssignments.id, candidate.assignmentId));
    count++;
  }

  if (count > 0) {
    await auditLog({
      organizationId: orgId,
      entityType: "userTargetRoleAssignment",
      entityId: 0,
      action: "bulk_approved",
      actorEmail,
      newValue: JSON.stringify({ count, threshold: 85 }),
    });
  }

  return NextResponse.json({ success: true, count });
}
