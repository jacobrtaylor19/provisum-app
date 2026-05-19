import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth";
import { getOrgId } from "@/lib/org-context";
import { safeError } from "@/lib/errors";
import { validatePassword } from "@/lib/password-policy";
import { createAdminClient } from "@/lib/supabase/admin";
import { auditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "system_admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const users = await db.select({
    id: schema.appUsers.id,
    username: schema.appUsers.username,
    displayName: schema.appUsers.displayName,
    email: schema.appUsers.email,
    role: schema.appUsers.role,
    isActive: schema.appUsers.isActive,
    createdAt: schema.appUsers.createdAt,
    passwordHash: schema.appUsers.passwordHash,
  }).from(schema.appUsers);

  // Get invite statuses
  const invites = await db.select({
    appUserId: schema.userInvites.appUserId,
    status: schema.userInvites.status,
  }).from(schema.userInvites);

  // Build a map of latest invite status per user
  const inviteStatusMap = new Map<number, string>();
  for (const inv of invites) {
    // Keep the most relevant status: accepted > pending > expired
    const existing = inviteStatusMap.get(inv.appUserId);
    if (!existing || inv.status === "accepted" || (inv.status === "pending" && existing === "expired")) {
      inviteStatusMap.set(inv.appUserId, inv.status);
    }
  }

  const result = users.map(({ passwordHash, ...u }) => ({
    ...u,
    inviteStatus: inviteStatusMap.get(u.id) ?? (passwordHash ? null : "no_invite"),
  }));

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "system_admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const { username, displayName, email, password, role } = await req.json();
    if (!username || !displayName || !password || !role) {
      return NextResponse.json({ error: "Username, display name, password, and role required" }, { status: 400 });
    }

    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) {
      return NextResponse.json({ error: "Password does not meet requirements", details: pwCheck.errors }, { status: 400 });
    }

    const [existing] = await db.select().from(schema.appUsers).where(eq(schema.appUsers.username, username)).limit(1);
    if (existing) {
      return NextResponse.json({ error: "Username already exists" }, { status: 400 });
    }

    // Create Supabase Auth user via admin API
    const supabaseAdmin = createAdminClient();
    const authEmail = email || `${username}@provisum.local`;

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true,
    });

    if (authError || !authData.user) {
      return NextResponse.json(
        { error: `Failed to create auth user: ${authError?.message || "Unknown error"}` },
        { status: 500 }
      );
    }

    const [created] = await db.insert(schema.appUsers).values({
      username,
      displayName,
      email: authEmail,
      passwordHash: "",
      role,
      supabaseAuthId: authData.user.id,
      organizationId: getOrgId(user),
    }).returning();

    await auditLog({
      organizationId: user.organizationId,
      entityType: "appUser",
      entityId: created.id,
      action: "created",
      newValue: JSON.stringify({ username, role }),
      actorEmail: user.username,
    });

    return NextResponse.json({ success: true, id: created.id });
  } catch (err: unknown) {
    const message = safeError(err, "Failed to create user");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
