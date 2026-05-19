import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth";
import { safeError } from "@/lib/errors";
import { WORKFLOW } from "@/lib/constants";
import { auditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    if (user.role !== "mapper" && user.role !== "admin" && user.role !== "system_admin") {
      return NextResponse.json({ error: "Only mappers can save refinements" }, { status: 403 });
    }

    const { userId, targetRoleIds, personaId } = await req.json();
    if (!userId || !Array.isArray(targetRoleIds)) {
      return NextResponse.json({ error: "userId and targetRoleIds required" }, { status: 400 });
    }

    // Get current assignments for this user
    const currentAssignments = await db
      .select()
      .from(schema.userTargetRoleAssignments)
      .where(eq(schema.userTargetRoleAssignments.userId, userId));

    // Gate: only allow edits when all assignments are in an editable status
    const nonEditableAssignments = currentAssignments.filter(
      (a) => !WORKFLOW.EDITABLE_STATUSES.includes(a.status)
    );
    if (nonEditableAssignments.length > 0) {
      return NextResponse.json(
        { error: "Assignments can only be edited while in Draft status. Send back to Draft first." },
        { status: 400 }
      );
    }

    const currentRoleIds = new Set(currentAssignments.map(a => a.targetRoleId));
    const desiredRoleIds = new Set<number>(targetRoleIds);

    // Get persona default role IDs if persona exists
    const personaDefaultRoleIds = new Set<number>();
    if (personaId) {
      const mappings = await db
        .select({ targetRoleId: schema.personaTargetRoleMappings.targetRoleId })
        .from(schema.personaTargetRoleMappings)
        .where(eq(schema.personaTargetRoleMappings.personaId, personaId));
      for (const m of mappings) personaDefaultRoleIds.add(m.targetRoleId);
    }

    // Roles to add (in desired but not current)
    const toAdd = targetRoleIds.filter((id: number) => !currentRoleIds.has(id));
    // Roles to remove (in current but not desired)
    const toRemove = currentAssignments.filter(a => !desiredRoleIds.has(a.targetRoleId));

    // Add new assignments
    for (const roleId of toAdd) {
      const isDefault = personaDefaultRoleIds.has(roleId);
      await db.insert(schema.userTargetRoleAssignments).values({
        userId,
        targetRoleId: roleId,
        derivedFromPersonaId: personaId ?? null,
        assignmentType: isDefault ? "persona_default" : "individual_override",
        status: "draft",
        mappedBy: user.username,
      });
    }

    // Remove assignments
    for (const assignment of toRemove) {
      await db.delete(schema.userTargetRoleAssignments)
        .where(eq(schema.userTargetRoleAssignments.id, assignment.id));
    }

    // Audit log
    await auditLog({
      organizationId: user.organizationId,
      entityType: "userRefinement",
      entityId: userId,
      action: "refinements_saved",
      actorEmail: user.email ?? user.username,
      oldValue: JSON.stringify({ roleIds: Array.from(currentRoleIds) }),
      newValue: JSON.stringify({ roleIds: targetRoleIds, added: toAdd, removed: toRemove.map(a => a.targetRoleId) }),
    });

    return NextResponse.json({
      success: true,
      added: toAdd.length,
      removed: toRemove.length,
    });
  } catch (err: unknown) {
    const message = safeError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
