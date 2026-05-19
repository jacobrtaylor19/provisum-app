import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth";
import { sendInviteEmail } from "@/lib/email";
import { safeError } from "@/lib/errors";
import { auditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "system_admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const { appUserId } = await req.json();

    if (!appUserId) {
      return NextResponse.json({ error: "appUserId is required" }, { status: 400 });
    }

    const [appUser] = await db
      .select()
      .from(schema.appUsers)
      .where(eq(schema.appUsers.id, appUserId))
      .limit(1);

    if (!appUser || !appUser.email) {
      return NextResponse.json({ error: "User not found or has no email" }, { status: 400 });
    }

    // Expire any existing pending invites for this user
    const existingInvites = await db
      .select()
      .from(schema.userInvites)
      .where(eq(schema.userInvites.appUserId, appUserId));

    for (const inv of existingInvites) {
      if (inv.status === "pending") {
        await db
          .update(schema.userInvites)
          .set({ status: "expired" })
          .where(eq(schema.userInvites.id, inv.id));
      }
    }

    // Generate new invite token
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await db.insert(schema.userInvites).values({
      appUserId,
      token,
      email: appUser.email,
      expiresAt,
    });

    const emailResult = await sendInviteEmail(appUser.email, token, appUser.displayName);

    await auditLog({
      organizationId: user.organizationId,
      entityType: "appUser",
      entityId: appUserId,
      action: "invite_resent",
      newValue: JSON.stringify({ email: appUser.email }),
      actorEmail: user.username,
    });

    return NextResponse.json({
      success: true,
      emailSent: emailResult.success,
      emailError: emailResult.error,
    });
  } catch (err: unknown) {
    const message = safeError(err, "Failed to resend invite");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
