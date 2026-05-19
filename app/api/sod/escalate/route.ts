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

    const { conflictId, comment } = await req.json();
    if (!conflictId) {
      return NextResponse.json({ error: "conflictId required" }, { status: 400 });
    }

    // Escalation requires a mandatory comment from the mapper
    if (!comment?.trim()) {
      return NextResponse.json({ error: "A comment explaining the escalation reason is required" }, { status: 400 });
    }

    const [conflict] = await db.select().from(schema.sodConflicts).where(eq(schema.sodConflicts.id, conflictId)).limit(1);
    if (!conflict) {
      return NextResponse.json({ error: "Conflict not found" }, { status: 404 });
    }

    // Update conflict status to sod_escalated
    await db.update(schema.sodConflicts).set({
      resolutionStatus: "escalated",
      resolutionNotes: conflict.resolutionNotes
        ? `${conflict.resolutionNotes}\n\n[ESCALATED by ${user.username}]: ${comment.trim()}`
        : `[ESCALATED by ${user.username}]: ${comment.trim()}`,
    }).where(eq(schema.sodConflicts.id, conflictId));

    // Also set the user's assignments to sod_escalated status
    await db.update(schema.userTargetRoleAssignments).set({
      status: "sod_escalated",
      updatedAt: new Date().toISOString(),
    }).where(and(
      eq(schema.userTargetRoleAssignments.userId, conflict.userId),
      eq(schema.userTargetRoleAssignments.status, "sod_rejected")
    ));

    await auditLog({
      organizationId: user.organizationId,
      entityType: "sodConflict",
      entityId: conflictId,
      action: "escalated",
      actorEmail: user.email ?? user.username,
      oldValue: JSON.stringify({ resolutionStatus: conflict.resolutionStatus }),
      newValue: JSON.stringify({ resolutionStatus: "escalated", comment: comment.trim() }),
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = safeError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
