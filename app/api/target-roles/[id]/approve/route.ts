import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth";
import { getOrgId } from "@/lib/org-context";
import { auditLog } from "@/lib/audit";
import { safeError } from "@/lib/errors";
import { notifyUsersWithRoles } from "@/lib/notifications";
import { captureApprovalSnapshot } from "@/lib/policy-drift";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    if (!["admin", "system_admin", "security_architect"].includes(user.role)) {
      return NextResponse.json({ error: "Only security architects and admins can approve roles" }, { status: 403 });
    }

    const orgId = getOrgId(user);
    const roleId = parseInt(params.id, 10);

    const [role] = await db
      .select()
      .from(schema.targetRoles)
      .where(and(eq(schema.targetRoles.id, roleId), eq(schema.targetRoles.organizationId, orgId)));

    if (!role) return NextResponse.json({ error: "Role not found" }, { status: 404 });

    if (role.status !== "draft") {
      return NextResponse.json({ error: "Only draft roles can be approved" }, { status: 400 });
    }

    // Capture the permission-set baseline for policy-drift detection (#42).
    const { hash: approvedPermissionHash, snapshot: approvedPermissionSnapshot } =
      await captureApprovalSnapshot(roleId);

    await db.update(schema.targetRoles).set({
      status: "active",
      approvedBy: user.id,
      approvedAt: new Date().toISOString(),
      approvedPermissionHash,
      approvedPermissionSnapshot,
      updatedAt: new Date().toISOString(),
      updatedBy: user.id,
    }).where(eq(schema.targetRoles.id, roleId));

    await auditLog({
      organizationId: orgId,
      entityType: "target_role",
      entityId: roleId,
      action: "role.approved",
      actorEmail: user.email ?? user.username,
      oldValue: JSON.stringify({ status: "draft" }),
      newValue: JSON.stringify({ status: "active", approvedBy: user.id }),
    });

    // Notify mappers that a new role is available (Block E)
    notifyUsersWithRoles({
      roles: ["mapper", "admin", "system_admin"],
      notificationType: "workflow_event",
      subject: `New role available: ${role.roleName}`,
      message: `${role.roleName} has been approved by ${user.displayName} and is now available for assignment.`,
      actionUrl: "/mapping",
    }).catch(() => {});

    const [updated] = await db.select().from(schema.targetRoles).where(eq(schema.targetRoles.id, roleId));
    return NextResponse.json({ role: updated });
  } catch (err: unknown) {
    return NextResponse.json({ error: safeError(err) }, { status: 500 });
  }
}
