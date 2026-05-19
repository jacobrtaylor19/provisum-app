import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { createAdminClient } from "@/lib/supabase/admin";
import { validatePassword } from "@/lib/password-policy";
import { safeError } from "@/lib/errors";
import { auditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { token, password } = await req.json();

    if (!token || !password) {
      return NextResponse.json({ error: "Token and password are required" }, { status: 400 });
    }

    // Validate password policy
    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) {
      return NextResponse.json(
        { error: "Password does not meet requirements", details: pwCheck.errors },
        { status: 400 }
      );
    }

    // Look up the invite
    const [invite] = await db
      .select()
      .from(schema.userInvites)
      .where(eq(schema.userInvites.token, token))
      .limit(1);

    if (!invite) {
      return NextResponse.json({ error: "Invalid invite token" }, { status: 400 });
    }

    if (invite.status !== "pending") {
      return NextResponse.json({ error: "This invite has already been used" }, { status: 400 });
    }

    // Check expiry
    if (new Date(invite.expiresAt) < new Date()) {
      await db
        .update(schema.userInvites)
        .set({ status: "expired" })
        .where(eq(schema.userInvites.id, invite.id));
      return NextResponse.json({ error: "This invite has expired" }, { status: 400 });
    }

    // Get the app user to find their supabaseAuthId
    const [appUser] = await db
      .select()
      .from(schema.appUsers)
      .where(eq(schema.appUsers.id, invite.appUserId))
      .limit(1);

    if (!appUser || !appUser.supabaseAuthId) {
      return NextResponse.json({ error: "User account not found" }, { status: 400 });
    }

    // Update password via Supabase admin API
    const supabaseAdmin = createAdminClient();
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      appUser.supabaseAuthId,
      { password }
    );

    if (updateError) {
      return NextResponse.json(
        { error: `Failed to set password: ${updateError.message}` },
        { status: 500 }
      );
    }

    // Mark invite as accepted
    await db
      .update(schema.userInvites)
      .set({ status: "accepted", acceptedAt: new Date().toISOString() })
      .where(eq(schema.userInvites.id, invite.id));

    // Audit log
    await auditLog({
      organizationId: appUser.organizationId,
      entityType: "appUser",
      entityId: appUser.id,
      action: "invite_accepted",
      newValue: JSON.stringify({ email: invite.email }),
      actorEmail: appUser.username,
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = safeError(err, "Failed to accept invite");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
