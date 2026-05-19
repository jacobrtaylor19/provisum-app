import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { getOrgId } from "@/lib/org-context";
import { auditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !["admin", "system_admin", "mapper", "coordinator"].includes(user.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = await req.json();
  const { name, businessFunction, description } = body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const orgId = getOrgId(user);

  const [persona] = await db.insert(schema.personas).values({
    organizationId: orgId,
    name: name.trim(),
    description: description?.trim() || null,
    businessFunction: businessFunction?.trim() || null,
    source: "manual",
  }).returning();

  await auditLog({
    organizationId: orgId,
    entityType: "persona",
    entityId: persona.id,
    action: "manual_create",
    newValue: JSON.stringify({ name: persona.name, businessFunction: persona.businessFunction }),
    actorEmail: user.email ?? user.username,
  });

  return NextResponse.json({ id: persona.id, name: persona.name });
}
