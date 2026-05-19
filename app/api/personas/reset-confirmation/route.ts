import { NextResponse } from "next/server";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth";
import { getOrgId } from "@/lib/org-context";
import { auditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Only admin/system_admin can reset confirmations
  if (!["admin", "system_admin"].includes(user.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  let body: { orgUnitId: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { orgUnitId } = body;

  if (!orgUnitId) {
    return NextResponse.json({ error: "orgUnitId is required" }, { status: 400 });
  }

  // Find existing active confirmation
  const [existing] = await db
    .select()
    .from(schema.personaConfirmations)
    .where(
      and(
        eq(schema.personaConfirmations.orgUnitId, orgUnitId),
        isNull(schema.personaConfirmations.resetAt)
      )
    )
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "No active confirmation found for this org unit" }, { status: 404 });
  }

  const now = new Date().toISOString();
  await db.update(schema.personaConfirmations)
    .set({
      resetAt: now,
      resetBy: user.id,
    })
    .where(eq(schema.personaConfirmations.id, existing.id));

  // Audit log
  await auditLog({
    organizationId: getOrgId(user),
    entityType: "personaConfirmation",
    entityId: existing.id,
    action: "persona_confirmation_reset",
    oldValue: JSON.stringify({ confirmedBy: existing.confirmedBy, confirmedAt: existing.confirmedAt }),
    newValue: JSON.stringify({ resetBy: user.id, resetAt: now }),
    actorEmail: user.email ?? user.username,
  });

  return NextResponse.json({ success: true });
}
