import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth";
import { safeError } from "@/lib/errors";
import { auditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Only mappers (and admins) can fix mappings
    if (user.role !== "mapper" && user.role !== "admin") {
      return NextResponse.json({ error: "Only mappers can fix mappings" }, { status: 403 });
    }

    const { conflictId, removeRoleId } = await req.json();
    if (!conflictId || !removeRoleId) {
      return NextResponse.json({ error: "conflictId and removeRoleId required" }, { status: 400 });
    }

    const [conflict] = await db.select().from(schema.sodConflicts).where(eq(schema.sodConflicts.id, conflictId)).limit(1);
    if (!conflict) {
      return NextResponse.json({ error: "Conflict not found" }, { status: 404 });
    }

    if (conflict.resolutionStatus !== "open") {
      return NextResponse.json({ error: "Conflict is already resolved" }, { status: 400 });
    }

    // Validate the removeRoleId is one of the conflicting roles
    if (conflict.roleIdA !== removeRoleId && conflict.roleIdB !== removeRoleId) {
      return NextResponse.json({ error: "removeRoleId must be one of the conflicting roles" }, { status: 400 });
    }

    // Remove the target role assignment for this user
    const deleted = await db.delete(schema.userTargetRoleAssignments)
      .where(and(
        eq(schema.userTargetRoleAssignments.userId, conflict.userId),
        eq(schema.userTargetRoleAssignments.targetRoleId, removeRoleId),
      ))
      .returning();

    // Mark the SOD conflict as resolved
    await db.update(schema.sodConflicts).set({
      resolutionStatus: "mapping_fixed",
      resolvedBy: user.username,
      resolvedAt: new Date().toISOString(),
      resolutionNotes: `Removed target role assignment (roleId=${removeRoleId}) to resolve conflict`,
    }).where(eq(schema.sodConflicts.id, conflictId));

    // Check if all conflicts for this user are now resolved
    const remainingOpen = await db.select().from(schema.sodConflicts)
      .where(and(
        eq(schema.sodConflicts.userId, conflict.userId),
        eq(schema.sodConflicts.resolutionStatus, "open")
      ));

    if (remainingOpen.length === 0) {
      // All conflicts resolved — transition sod_rejected assignments back to DRAFT
      // so they re-enter SOD analysis before reaching compliance_approved.
      // A fix does NOT skip the SOD gate.
      await db.update(schema.userTargetRoleAssignments).set({
        status: "draft",
        updatedAt: new Date().toISOString(),
      }).where(and(
        eq(schema.userTargetRoleAssignments.userId, conflict.userId),
        eq(schema.userTargetRoleAssignments.status, "sod_rejected")
      ));
    }

    // Audit log
    await auditLog({
      organizationId: user.organizationId,
      entityType: "sodConflict",
      entityId: conflictId,
      action: "mapping_fixed",
      actorEmail: user.email ?? user.username,
      oldValue: JSON.stringify({ resolutionStatus: "open" }),
      newValue: JSON.stringify({
        resolutionStatus: "mapping_fixed",
        removedRoleId: removeRoleId,
        removedAssignments: deleted.length,
      }),
    });

    return NextResponse.json({ success: true, removedAssignments: deleted.length });
  } catch (err: unknown) {
    const message = safeError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
