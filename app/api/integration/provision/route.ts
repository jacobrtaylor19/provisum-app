import { NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateApiKey } from "@/lib/integration-auth";
import { safeError } from "@/lib/errors";
import { reportError, reportMessage } from "@/lib/monitoring";
import { auditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PLAN_USER_LIMITS: Record<string, number> = {
  standard: 500,
  professional: 3000,
  enterprise: 10000,
};

const provisionSchema = z.object({
  externalId: z.string().min(1),
  customerName: z.string().min(1),
  customerEmail: z.string().email(),
  company: z.string().min(1),
  orgName: z.string().min(1),
  plan: z.enum(["standard", "professional", "enterprise"]),
  licenseYears: z.number().int().min(1).max(3),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export async function POST(request: Request) {
  // 1. Validate API key
  if (!validateApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 2. Validate body
    const body = await request.json();
    const parsed = provisionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { externalId, customerName, customerEmail, company, orgName, plan, licenseYears } = parsed.data;

    reportMessage(`[provision] Starting provisioning for ${customerEmail} (${plan} plan, ${licenseYears}yr)`, "info");

    // 3. Check email doesn't already exist in appUsers
    const [existing] = await db
      .select({ id: schema.appUsers.id })
      .from(schema.appUsers)
      .where(eq(schema.appUsers.email, customerEmail.toLowerCase()))
      .limit(1);

    if (existing) {
      return NextResponse.json(
        { success: false, error: "A user with this email already exists" },
        { status: 409 }
      );
    }

    // 4. Generate unique slug
    let baseSlug = slugify(orgName);
    if (!baseSlug) baseSlug = slugify(company);
    if (!baseSlug) baseSlug = "org";

    let slug = baseSlug;
    let suffix = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const [slugCheck] = await db
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(eq(schema.organizations.slug, slug))
        .limit(1);
      if (!slugCheck) break;
      suffix++;
      slug = `${baseSlug}-${suffix}`;
    }

    // 5. Compute license expiry
    const expiresDate = new Date();
    expiresDate.setFullYear(expiresDate.getFullYear() + licenseYears);
    const licenseExpiresAt = expiresDate.toISOString();

    // 6. Create organization
    const [org] = await db
      .insert(schema.organizations)
      .values({
        name: orgName,
        slug,
        description: `${company} — provisioned via get-started flow`,
        planTier: plan,
        maxUsers: PLAN_USER_LIMITS[plan] ?? 500,
        licenseYears,
        licenseExpiresAt,
        isActive: true,
      })
      .returning();

    reportMessage(`[provision] Created organization ${org.id} (slug: ${slug})`, "info");

    // 7. Create Supabase Auth user (no password — they'll set it via invite)
    const supabaseAdmin = createAdminClient();
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: customerEmail.toLowerCase(),
      email_confirm: true,
    });

    if (authError || !authData.user) {
      reportError(new Error(authError?.message || "Unknown auth error"), { context: "provision-supabase-auth" });
      return NextResponse.json(
        { success: false, error: `Failed to create auth user: ${authError?.message || "Unknown error"}` },
        { status: 500 }
      );
    }

    // 8. Create app_users row (admin role for the org owner)
    const username = customerEmail
      .toLowerCase()
      .split("@")[0]
      .replace(/[^a-zA-Z0-9._-]/g, "")
      .toLowerCase();

    const [appUser] = await db
      .insert(schema.appUsers)
      .values({
        organizationId: org.id,
        username,
        displayName: customerName,
        email: customerEmail.toLowerCase(),
        passwordHash: "",
        role: "admin",
        supabaseAuthId: authData.user.id,
      })
      .returning();

    reportMessage(`[provision] Created app user ${appUser.id} (admin) for org ${org.id}`, "info");

    // 9. Generate invite token (7-day expiry for new customers)
    const token = crypto.randomUUID();
    const inviteExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await db.insert(schema.userInvites).values({
      appUserId: appUser.id,
      token,
      email: customerEmail.toLowerCase(),
      expiresAt: inviteExpiry,
    });

    // 10. Audit log
    await auditLog({
      organizationId: org.id,
      entityType: "organization",
      entityId: org.id,
      action: "provisioned",
      newValue: JSON.stringify({
        externalId,
        plan,
        licenseYears,
        customerEmail,
        company,
        slug,
      }),
      actorEmail: "system",
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.provisum.io";
    const setupUrl = `${baseUrl}/setup?token=${token}`;

    reportMessage(`[provision] Provisioning complete for ${customerEmail}`, "info");

    return NextResponse.json({
      success: true,
      organizationId: org.id,
      organizationSlug: slug,
      appUserId: appUser.id,
      setupUrl,
      environmentUrl: baseUrl,
    });
  } catch (err: unknown) {
    reportError(err instanceof Error ? err : new Error(String(err)), { context: "provision" });
    const message = safeError(err, "Provisioning failed");
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
