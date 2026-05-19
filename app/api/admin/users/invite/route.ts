import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendInviteEmail } from "@/lib/email";
import { safeError } from "@/lib/errors";
import { dispatchWebhookEvent } from "@/lib/webhooks";
import { getOrgId } from "@/lib/org-context";
import { checkUserLimit } from "@/lib/license";
import { auditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

const VALID_ROLES = [
  "system_admin",
  "admin",
  "project_manager",
  "approver",
  "coordinator",
  "mapper",
  "viewer",
];

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "system_admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const { email, displayName, role, assignedOrgUnitId } = await req.json();

    // Check license user limit
    const licenseCheck = await checkUserLimit(getOrgId(user));
    if (!licenseCheck.allowed) {
      return NextResponse.json({
        error: `User limit reached (${licenseCheck.currentCount}/${licenseCheck.maxUsers}). Upgrade your plan to add more users.`,
      }, { status: 403 });
    }

    if (!email || !displayName || !role) {
      return NextResponse.json(
        { error: "Email, display name, and role are required" },
        { status: 400 }
      );
    }

    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json(
        { error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}` },
        { status: 400 }
      );
    }

    // Check for existing user with this email
    const [existing] = await db
      .select()
      .from(schema.appUsers)
      .where(eq(schema.appUsers.email, email))
      .limit(1);

    if (existing) {
      return NextResponse.json({ error: "A user with this email already exists" }, { status: 400 });
    }

    // Create Supabase auth user without a password
    const supabaseAdmin = createAdminClient();
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
    });

    if (authError || !authData.user) {
      return NextResponse.json(
        { error: `Failed to create auth user: ${authError?.message || "Unknown error"}` },
        { status: 500 }
      );
    }

    // Derive username from email (part before @)
    const username = email.split("@")[0].replace(/[^a-zA-Z0-9._-]/g, "").toLowerCase();

    // Create app_users row
    const [appUser] = await db
      .insert(schema.appUsers)
      .values({
        organizationId: getOrgId(user),
        username,
        displayName,
        email,
        passwordHash: "",
        role,
        assignedOrgUnitId: assignedOrgUnitId || null,
        supabaseAuthId: authData.user.id,
      })
      .returning();

    // Generate invite token and store it
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await db.insert(schema.userInvites).values({
      appUserId: appUser.id,
      token,
      email,
      expiresAt,
    });

    // Send invite email
    const emailResult = await sendInviteEmail(email, token, displayName);

    // Audit log
    await auditLog({
      organizationId: user.organizationId,
      entityType: "appUser",
      entityId: appUser.id,
      action: "invited",
      newValue: JSON.stringify({ email, role, displayName }),
      actorEmail: user.username,
    });

    dispatchWebhookEvent("user.invited", { email, invitedBy: user.displayName }).catch(() => {});

    return NextResponse.json({
      success: true,
      id: appUser.id,
      username,
      emailSent: emailResult.success,
      emailError: emailResult.error,
    });
  } catch (err: unknown) {
    const message = safeError(err, "Failed to invite user");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
