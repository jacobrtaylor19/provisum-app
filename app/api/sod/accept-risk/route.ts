import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { safeError } from "@/lib/errors";
import { auditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Only approvers and admins can accept risk
    if (user.role !== "approver" && user.role !== "admin" && user.role !== "system_admin") {
      return NextResponse.json({ error: "Only approvers can accept SOD risk." }, { status: 403 });
    }

    const { conflictId, justification, action, mitigatingControl, controlOwner, controlFrequency } = await req.json();
    if (!conflictId) {
      return NextResponse.json({ error: "conflictId required" }, { status: 400 });
    }

    const [conflict] = await db.select().from(schema.sodConflicts).where(eq(schema.sodConflicts.id, conflictId)).limit(1);
    if (!conflict) {
      return NextResponse.json({ error: "Conflict not found" }, { status: 404 });
    }

    // Check if risk acceptance is allowed for this severity level (from workflow settings)
    const severity = conflict.severity;
    if (severity === "critical") {
      // Critical is never risk-acceptable regardless of settings
      return NextResponse.json({ error: "Critical severity conflicts cannot be risk-accepted." }, { status: 400 });
    }
    if (severity === "high" && (await getSetting("workflow.sodHighRiskAcceptable")) === "false") {
      return NextResponse.json({ error: "High severity risk acceptance is disabled by workflow settings." }, { status: 400 });
    }
    if (severity === "medium" && (await getSetting("workflow.sodMediumRiskAcceptable")) === "false") {
      return NextResponse.json({ error: "Medium severity risk acceptance is disabled by workflow settings." }, { status: 400 });
    }
    if (severity === "low" && (await getSetting("workflow.sodLowRiskAcceptable")) === "false") {
      return NextResponse.json({ error: "Low severity risk acceptance is disabled by workflow settings." }, { status: 400 });
    }

    // Handle reject action
    if (action === "reject") {
      await db.update(schema.sodConflicts).set({
        resolutionStatus: "open",
        resolutionNotes: conflict.resolutionNotes
          ? `${conflict.resolutionNotes}\n\n[REJECTED by ${user.username}]: ${justification ?? "No reason provided"}`
          : `[REJECTED by ${user.username}]: ${justification ?? "No reason provided"}`,
      }).where(eq(schema.sodConflicts.id, conflictId));

      await auditLog({
        organizationId: user.organizationId,
        entityType: "sodConflict",
        entityId: conflictId,
        action: "risk_acceptance_rejected",
        actorEmail: user.email ?? user.username,
        oldValue: JSON.stringify({ resolutionStatus: conflict.resolutionStatus }),
        newValue: JSON.stringify({ resolutionStatus: "open" }),
      });

      return NextResponse.json({ success: true, action: "rejected" });
    }

    // Default: approve risk acceptance
    const finalJustification = justification ?? conflict.resolutionNotes ?? "";

    const updatePayload: Record<string, unknown> = {
      resolutionStatus: "risk_accepted",
      resolvedBy: user.username,
      resolvedAt: new Date().toISOString(),
      resolutionNotes: finalJustification,
    };

    // Save mitigating control fields if provided
    if (mitigatingControl) updatePayload.mitigatingControl = mitigatingControl;
    if (controlOwner) updatePayload.controlOwner = controlOwner;
    if (controlFrequency) updatePayload.controlFrequency = controlFrequency;

    await db.update(schema.sodConflicts).set(updatePayload).where(eq(schema.sodConflicts.id, conflictId));

    // Check if all conflicts for this user are resolved (not open or pending)
    const remainingUnresolved = await db.select().from(schema.sodConflicts)
      .where(and(
        eq(schema.sodConflicts.userId, conflict.userId),
        inArray(schema.sodConflicts.resolutionStatus, ["open", "pending_risk_acceptance"])
      ));

    if (remainingUnresolved.length === 0) {
      await db.update(schema.userTargetRoleAssignments).set({
        status: "sod_risk_accepted",
        riskAcceptedBy: user.username,
        riskAcceptedAt: new Date().toISOString(),
        riskJustification: "All SOD conflicts resolved via risk acceptance",
        updatedAt: new Date().toISOString(),
      }).where(and(
        eq(schema.userTargetRoleAssignments.userId, conflict.userId),
        eq(schema.userTargetRoleAssignments.status, "sod_rejected")
      ));
    }

    await auditLog({
      organizationId: user.organizationId,
      entityType: "sodConflict",
      entityId: conflictId,
      action: "risk_accepted",
      actorEmail: user.email ?? user.username,
      oldValue: JSON.stringify({ resolutionStatus: conflict.resolutionStatus }),
      newValue: JSON.stringify({ resolutionStatus: "risk_accepted", justification: finalJustification }),
    });

    return NextResponse.json({ success: true, action: "approved" });
  } catch (err: unknown) {
    const message = safeError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
