import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getOrgId, orgScope } from "@/lib/org-context";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { generateAIMappingSuggestions } from "@/lib/ai/mapping-suggestions";
import { reportError } from "@/lib/monitoring";
import { checkAIRate } from "@/lib/rate-limit-middleware";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_ROLES = ["mapper", "admin", "system_admin"];

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Engine PRD §13: inference routes require auth + rate limiting before any
  // model router is exposed. This route calls Claude via generateAIMappingSuggestions.
  const rateLimited = await checkAIRate(req, String(user.id));
  if (rateLimited) return rateLimited;

  const personaIdParam = req.nextUrl.searchParams.get("personaId");
  if (!personaIdParam) {
    return NextResponse.json({ error: "personaId is required" }, { status: 400 });
  }
  const personaId = parseInt(personaIdParam, 10);
  if (isNaN(personaId)) {
    return NextResponse.json({ error: "personaId must be a number" }, { status: 400 });
  }

  const orgId = getOrgId(user);

  try {
    // 1. Load persona
    const [persona] = await db
      .select({
        id: schema.personas.id,
        name: schema.personas.name,
        businessFunction: schema.personas.businessFunction,
        description: schema.personas.description,
      })
      .from(schema.personas)
      .where(and(eq(schema.personas.id, personaId), orgScope(schema.personas.organizationId, orgId)));

    if (!persona) {
      return NextResponse.json({ error: "Persona not found" }, { status: 404 });
    }

    // 2. Load persona's source permissions (as proxy for source roles)
    const sourcePermissions = await db
      .select({
        permissionId: schema.sourcePermissions.permissionId,
        permissionName: schema.sourcePermissions.permissionName,
      })
      .from(schema.personaSourcePermissions)
      .innerJoin(schema.sourcePermissions, eq(schema.sourcePermissions.id, schema.personaSourcePermissions.sourcePermissionId))
      .where(eq(schema.personaSourcePermissions.personaId, personaId));

    const sourceRoles = [{
      name: persona.name,
      description: persona.description || "",
      permissions: sourcePermissions.map((p) => p.permissionName || p.permissionId),
    }];

    // 3. Load target roles with their permissions
    const targetRolesRaw = await db
      .select({
        id: schema.targetRoles.id,
        roleName: schema.targetRoles.roleName,
        description: schema.targetRoles.description,
        domain: schema.targetRoles.domain,
      })
      .from(schema.targetRoles)
      .where(orgScope(schema.targetRoles.organizationId, orgId));

    // Load permissions for each target role (batch query)
    const targetRolePermissions = await db
      .select({
        targetRoleId: schema.targetRolePermissions.targetRoleId,
        permissionName: schema.targetPermissions.permissionName,
        permissionId: schema.targetPermissions.permissionId,
      })
      .from(schema.targetRolePermissions)
      .innerJoin(schema.targetPermissions, eq(schema.targetPermissions.id, schema.targetRolePermissions.targetPermissionId));

    const permsByRole = new Map<number, string[]>();
    for (const p of targetRolePermissions) {
      const list = permsByRole.get(p.targetRoleId) || [];
      list.push(p.permissionName || p.permissionId);
      permsByRole.set(p.targetRoleId, list);
    }

    const targetRoles = targetRolesRaw.map((r) => ({
      name: r.roleName,
      description: r.description || "",
      permissions: permsByRole.get(r.id) || [],
    }));

    // 4. Calculate overlap scores (permission name matching)
    const sourcePermSet = new Set(sourcePermissions.map((p) => (p.permissionName || p.permissionId).toLowerCase()));
    const overlapScores = targetRolesRaw.map((r) => {
      const targetPerms = permsByRole.get(r.id) || [];
      if (sourcePermSet.size === 0 || targetPerms.length === 0) {
        return { targetRoleId: r.id, targetRoleName: r.roleName, overlapPct: 0 };
      }
      const matching = targetPerms.filter((p) => sourcePermSet.has(p.toLowerCase())).length;
      const overlapPct = (matching / sourcePermSet.size) * 100;
      return { targetRoleId: r.id, targetRoleName: r.roleName, overlapPct };
    });

    // 5. Load existing mapping feedback for historical context
    const feedback = await db
      .select({
        personaName: schema.personas.name,
        targetRoleName: schema.targetRoles.roleName,
        accepted: schema.mappingFeedback.accepted,
      })
      .from(schema.mappingFeedback)
      .innerJoin(schema.personas, eq(schema.personas.id, schema.mappingFeedback.personaId))
      .innerJoin(schema.targetRoles, eq(schema.targetRoles.id, schema.mappingFeedback.targetRoleId))
      .where(orgScope(schema.mappingFeedback.organizationId, orgId));

    const existingMappings = feedback.map((f) => ({
      personaName: f.personaName,
      targetRoleName: f.targetRoleName,
      accepted: f.accepted,
    }));

    // 6. Call AI suggestion engine
    const suggestions = await generateAIMappingSuggestions(
      {
        id: persona.id,
        name: persona.name,
        businessFunction: persona.businessFunction || "",
        description: persona.description || "",
      },
      sourceRoles,
      targetRoles,
      existingMappings,
      overlapScores
    );

    return NextResponse.json({ suggestions });
  } catch (error) {
    reportError(error instanceof Error ? error : new Error(String(error)), { context: "ai-suggestions" });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate AI suggestions" },
      { status: 500 }
    );
  }
}
