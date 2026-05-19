import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { auditLog } from "@/lib/audit";
import { validatePassword } from "@/lib/password-policy";
import { validateBody } from "@/lib/validation";
import { changePasswordSchema } from "@/lib/validation/auth";
import { safeError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const validation = validateBody(changePasswordSchema, body);
    if (!validation.success) return validation.response;
    const { newPassword } = validation.data;

    // Validate new password strength
    const pwCheck = validatePassword(newPassword);
    if (!pwCheck.valid) {
      return NextResponse.json(
        { error: "New password does not meet requirements", details: pwCheck.errors },
        { status: 400 }
      );
    }

    // Update password via Supabase Auth
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (updateError) {
      return NextResponse.json(
        { error: `Failed to update password: ${updateError.message}` },
        { status: 500 }
      );
    }

    // Audit log the change (no password values)
    await auditLog({
      organizationId: user.organizationId,
      entityType: "auth",
      entityId: user.id,
      action: "password_changed",
      actorEmail: user.email || user.username,
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = safeError(err, "Failed to change password");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
