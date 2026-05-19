import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { safeError } from "@/lib/errors";
import { getSessionUser } from "@/lib/auth";
import { MAPPER_ROLES } from "@/lib/constants";
import { getOrgId } from "@/lib/org-context";
import { auditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

// PUT /api/mapping/persona-roles
// Body: { personaId: number, targetRoleIds: number[] }
// Replaces all manually-managed mappings for a persona, preserving AI-generated ones that aren't in the list
export async function PUT(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !(MAPPER_ROLES as readonly string[]).includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const { personaId, targetRoleIds } = body as { personaId: number; targetRoleIds: number[] };

    if (!personaId || !Array.isArray(targetRoleIds)) {
      return NextResponse.json({ error: "personaId and targetRoleIds required" }, { status: 400 });
    }

    // Get existing mappings for this persona
    const existing = await db
      .select()
      .from(schema.personaTargetRoleMappings)
      .where(eq(schema.personaTargetRoleMappings.personaId, personaId));

    const existingIds = new Set(existing.map((m) => m.targetRoleId));
    const newIds = new Set(targetRoleIds);

    // Remove roles that were deselected
    for (const mapping of existing) {
      if (!newIds.has(mapping.targetRoleId)) {
        await db.delete(schema.personaTargetRoleMappings)
          .where(
            and(
              eq(schema.personaTargetRoleMappings.personaId, personaId),
              eq(schema.personaTargetRoleMappings.targetRoleId, mapping.targetRoleId)
            )
          );
      }
    }

    // Add newly selected roles
    for (const roleId of targetRoleIds) {
      if (!existingIds.has(roleId)) {
        await db.insert(schema.personaTargetRoleMappings)
          .values({
            personaId,
            targetRoleId: roleId,
            mappingReason: "manual",
            confidence: "manual",
            isActive: true,
          });
      }
    }

    // Log action
    await auditLog({
      organizationId: getOrgId(user),
      entityType: "personaTargetRoleMapping",
      entityId: personaId,
      action: "manual_mapping_updated",
      actorEmail: user.email ?? user.username,
      newValue: JSON.stringify({ personaId, targetRoleIds }),
    });

    return NextResponse.json({ success: true, personaId, roleCount: targetRoleIds.length });
  } catch (err: unknown) {
    const message = safeError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
