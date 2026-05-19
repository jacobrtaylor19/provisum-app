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

  // Authorization: admin/system_admin can confirm any org unit;
  // mapper can only confirm their assigned org unit
  const isAdmin = ["admin", "system_admin"].includes(user.role);
  const isMapper = user.role === "mapper";

  if (!isAdmin && !isMapper) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  if (isMapper && user.assignedOrgUnitId !== orgUnitId) {
    return NextResponse.json(
      { error: "You can only confirm personas for your assigned org unit" },
      { status: 403 }
    );
  }

  // Check org unit exists
  const [orgUnit] = await db
    .select()
    .from(schema.orgUnits)
    .where(eq(schema.orgUnits.id, orgUnitId))
    .limit(1);

  if (!orgUnit) {
    return NextResponse.json({ error: "Org unit not found" }, { status: 404 });
  }

  // Check if already confirmed (not reset)
  const [existingConfirmation] = await db
    .select()
    .from(schema.personaConfirmations)
    .where(
      and(
        eq(schema.personaConfirmations.orgUnitId, orgUnitId),
        isNull(schema.personaConfirmations.resetAt)
      )
    )
    .limit(1);

  if (existingConfirmation) {
    return NextResponse.json({ error: "Personas already confirmed for this org unit" }, { status: 409 });
  }

  const now = new Date().toISOString();
  const [row] = await db
    .insert(schema.personaConfirmations)
    .values({
      orgUnitId,
      confirmedAt: now,
      confirmedBy: user.id,
    })
    .returning();

  // Audit log
  await auditLog({
    organizationId: getOrgId(user),
    entityType: "personaConfirmation",
    entityId: row.id,
    action: "persona_confirmed",
    newValue: JSON.stringify({ orgUnitId, confirmedBy: user.id }),
    actorEmail: user.email ?? user.username,
  });

  return NextResponse.json({ success: true, confirmation: row });
}
