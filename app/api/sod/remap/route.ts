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

    if (!["mapper", "admin", "system_admin"].includes(user.role)) {
      return NextResponse.json({ error: "Only mappers can initiate remapping" }, { status: 403 });
    }

    const { conflictId } = await req.json();
    if (!conflictId) {
      return NextResponse.json({ error: "conflictId required" }, { status: 400 });
    }

    const [conflict] = await db.select().from(schema.sodConflicts).where(eq(schema.sodConflicts.id, conflictId)).limit(1);
    if (!conflict) {
      return NextResponse.json({ error: "Conflict not found" }, { status: 404 });
    }

    if (conflict.resolutionStatus !== "open") {
      return NextResponse.json({ error: "Conflict is not in open status" }, { status: 400 });
    }

    if (conflict.conflictType !== "between_role") {
      return NextResponse.json({ error: "Remap is only available for between-role conflicts" }, { status: 400 });
    }

    // Set both conflicting role assignments to remap_required
    const roleIds = [conflict.roleIdA, conflict.roleIdB].filter((id): id is number => id !== null);
    let updated = 0;
    for (const roleId of roleIds) {
      const result = await db.update(schema.userTargetRoleAssignments).set({
        status: "remap_required",
        updatedAt: new Date().toISOString(),
      }).where(and(
        eq(schema.userTargetRoleAssignments.userId, conflict.userId),
        eq(schema.userTargetRoleAssignments.targetRoleId, roleId),
        eq(schema.userTargetRoleAssignments.status, "sod_rejected"),
      )).returning();
      updated += result.length;
    }

    // Mark the conflict as being remapped
    await db.update(schema.sodConflicts).set({
      resolutionStatus: "remapping_in_progress",
      resolvedBy: user.username,
      resolutionNotes: "Sent to re-mapping queue for role reassignment",
    }).where(eq(schema.sodConflicts.id, conflictId));

    // Audit log
    await auditLog({
      organizationId: user.organizationId,
      entityType: "sodConflict",
      entityId: conflictId,
      action: "assignment_remap_requested",
      actorEmail: user.email ?? user.username,
      newValue: JSON.stringify({ assignmentsUpdated: updated, roleIds }),
    });

    return NextResponse.json({ success: true, assignmentsUpdated: updated });
  } catch (err: unknown) {
    const message = safeError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
