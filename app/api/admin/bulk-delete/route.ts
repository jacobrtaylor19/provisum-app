import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { inArray } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth";
import { getOrgId } from "@/lib/org-context";
import { checkBulkRate } from "@/lib/rate-limit-middleware";
import { validateBody } from "@/lib/validation";
import { bulkDeleteSchema } from "@/lib/validation/admin";
import { safeError } from "@/lib/errors";
import { auditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

const ALLOWED_ENTITIES = {
  users: schema.users,
  personas: schema.personas,
  sourceRoles: schema.sourceRoles,
  targetRoles: schema.targetRoles,
  sodRules: schema.sodRules,
} as const;

type EntityType = keyof typeof ALLOWED_ENTITIES;

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || !["admin", "system_admin", "mapper", "coordinator"].includes(user.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const rateLimited = await checkBulkRate(request, String(user.id));
  if (rateLimited) return rateLimited;

  const body = await request.json();
  const validation = validateBody(bulkDeleteSchema, body);
  if (!validation.success) return validation.response;
  const { entityType, ids } = validation.data;

  if (!(entityType in ALLOWED_ENTITIES)) {
    return NextResponse.json({ error: `Invalid entityType: ${entityType}` }, { status: 400 });
  }

  const table = ALLOWED_ENTITIES[entityType as EntityType];

  try {
    await db.delete(table).where(inArray(table.id, ids));

    // Log each deletion to audit log
    await auditLog({
      organizationId: getOrgId(user),
      entityType,
      entityId: 0,
      action: "bulk_deleted",
      oldValue: JSON.stringify({ ids }),
      newValue: JSON.stringify({ count: ids.length }),
      actorEmail: user.email ?? user.username,
    });

    return NextResponse.json({ deleted: ids.length });
  } catch (err: unknown) {
    const message = safeError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
