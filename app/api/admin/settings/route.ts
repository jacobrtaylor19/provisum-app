import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getAllSettings, setSetting } from "@/lib/settings";
import { validateBody } from "@/lib/validation";
import { settingsSchema } from "@/lib/validation/admin";
import { safeError } from "@/lib/errors";
import { getOrgId } from "@/lib/org-context";
import { auditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "system_admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const settings = await getAllSettings();
  return NextResponse.json(settings);
}

export async function PUT(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== "system_admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const validation = validateBody(settingsSchema, body);
    if (!validation.success) return validation.response;
    const entries = Object.entries(validation.data) as [string, string][];

    for (const [key, value] of entries) {
      await setSetting(key, String(value), user.username);

      // Audit log the setting change (key only, not the value)
      await auditLog({
        organizationId: getOrgId(user),
        entityType: "system_setting",
        entityId: 0,
        action: "setting_updated",
        newValue: key,
        actorEmail: user.email || user.username,
      });
    }

    return NextResponse.json({ success: true, updated: entries.length });
  } catch (err: unknown) {
    const message = safeError(err, "Failed to update settings");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
