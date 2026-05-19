import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { safeError } from "@/lib/errors";
import { getSessionUser } from "@/lib/auth";
import { checkBulkRate } from "@/lib/rate-limit-middleware";
import { dispatchWebhookEvent } from "@/lib/webhooks";
import { auditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

const SEND_BACK_ROLES = ["system_admin", "admin", "mapper", "approver"];

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !SEND_BACK_ROLES.includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const rateLimited = await checkBulkRate(req, String(user.id));
  if (rateLimited) return rateLimited;

  try {
    const { assignmentId, reason } = await req.json();
    if (!assignmentId || !reason) {
      return NextResponse.json({ error: "assignmentId and reason required" }, { status: 400 });
    }

    const [assignment] = await db.select().from(schema.userTargetRoleAssignments)
      .where(eq(schema.userTargetRoleAssignments.id, assignmentId)).limit(1);
    if (!assignment) {
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    }

    await db.update(schema.userTargetRoleAssignments).set({
      status: "remap_required",
      sentBackReason: reason,
      updatedAt: new Date().toISOString(),
    }).where(eq(schema.userTargetRoleAssignments.id, assignmentId));

    await auditLog({
      organizationId: user.organizationId,
      entityType: "userTargetRoleAssignment",
      entityId: assignmentId,
      action: "sent_back",
      actorEmail: user.username,
      oldValue: JSON.stringify({ status: assignment.status }),
      newValue: JSON.stringify({ status: "remap_required", reason }),
    });

    dispatchWebhookEvent("mapping.rejected", { assignmentId, rejectedBy: user.displayName }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = safeError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
