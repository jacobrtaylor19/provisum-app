import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth";
import { safeError } from "@/lib/errors";
import { getOrgId } from "@/lib/org-context";
import { auditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** Check if the user can edit SOD rules: admin, system_admin, or role containing "compliance" or "security" */
function canEditSodRules(role: string): boolean {
  if (["admin", "system_admin"].includes(role)) return true;
  const lower = role.toLowerCase();
  return lower.includes("compliance") || lower.includes("security");
}

// POST — create or update a SOD rule
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || !canEditSodRules(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id, ruleId, ruleName, permissionA, permissionB, severity, riskDescription, isActive } = body;

  if (!ruleId || !ruleName || !permissionA || !permissionB || !severity) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const validSeverities = ["critical", "high", "medium", "low"];
  if (!validSeverities.includes(severity)) {
    return NextResponse.json({ error: `Invalid severity. Must be: ${validSeverities.join(", ")}` }, { status: 400 });
  }

  try {
    if (id) {
      // Update existing rule
      await db.update(schema.sodRules)
        .set({
          ruleId,
          ruleName,
          permissionA,
          permissionB,
          severity,
          riskDescription: riskDescription || null,
          isActive: isActive !== false,
        })
        .where(eq(schema.sodRules.id, id));

      // Audit log
      await auditLog({
        organizationId: user.organizationId,
        entityType: "sodRule",
        entityId: id,
        action: "updated",
        actorEmail: user.email || user.username,
        newValue: JSON.stringify({ ruleId, ruleName, severity, isActive }),
      });

      return NextResponse.json({ success: true, action: "updated" });
    } else {
      // Create new rule
      const [inserted] = await db.insert(schema.sodRules).values({
        organizationId: getOrgId(user),
        ruleId,
        ruleName,
        permissionA,
        permissionB,
        severity,
        riskDescription: riskDescription || null,
        isActive: isActive !== false,
      }).returning();

      await auditLog({
        organizationId: user.organizationId,
        entityType: "sodRule",
        entityId: inserted.id,
        action: "created",
        actorEmail: user.email || user.username,
        newValue: JSON.stringify({ ruleId, ruleName, severity }),
      });

      return NextResponse.json({ success: true, action: "created", id: inserted.id });
    }
  } catch (err) {
    const msg = safeError(err, "Unknown error");
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PATCH — toggle active/inactive
export async function PATCH(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || !canEditSodRules(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id, isActive } = body;
  if (!id || typeof isActive !== "boolean") {
    return NextResponse.json({ error: "Missing id or isActive" }, { status: 400 });
  }

  try {
    await db.update(schema.sodRules)
      .set({ isActive })
      .where(eq(schema.sodRules.id, id));

    await auditLog({
      organizationId: user.organizationId,
      entityType: "sodRule",
      entityId: id,
      action: isActive ? "activated" : "deactivated",
      actorEmail: user.email || user.username,
      newValue: JSON.stringify({ isActive }),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = safeError(err, "Unknown error");
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE — delete a SOD rule
export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || !canEditSodRules(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id } = body;
  if (!id || typeof id !== "number") {
    return NextResponse.json({ error: "Missing or invalid id" }, { status: 400 });
  }

  try {
    // Get rule info for audit log before deleting
    const [rule] = await db.select().from(schema.sodRules).where(eq(schema.sodRules.id, id)).limit(1);
    if (!rule) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }

    await db.delete(schema.sodRules).where(eq(schema.sodRules.id, id));

    await auditLog({
      organizationId: user.organizationId,
      entityType: "sodRule",
      entityId: id,
      action: "deleted",
      actorEmail: user.email || user.username,
      oldValue: JSON.stringify({ ruleId: rule.ruleId, ruleName: rule.ruleName, severity: rule.severity }),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = safeError(err, "Unknown error");
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
