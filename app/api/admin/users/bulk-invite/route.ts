import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { parse } from "csv-parse/sync";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendInviteEmail } from "@/lib/email";
import { safeError } from "@/lib/errors";
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

const MAX_ROWS = 100;

interface CsvRow {
  first_name: string;
  last_name: string;
  email: string;
  role: string;
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "system_admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "CSV file is required" }, { status: 400 });
    }

    const text = await file.text();
    let rows: CsvRow[];

    try {
      rows = parse(text, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as CsvRow[];
    } catch {
      return NextResponse.json({ error: "Failed to parse CSV. Ensure columns: first_name, last_name, email, role" }, { status: 400 });
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: "CSV file is empty" }, { status: 400 });
    }

    if (rows.length > MAX_ROWS) {
      return NextResponse.json({ error: `Maximum ${MAX_ROWS} users per upload` }, { status: 400 });
    }

    // Check license user limit before processing
    const licenseCheck = await checkUserLimit(getOrgId(user));
    if (licenseCheck.maxUsers !== null) {
      const remaining = licenseCheck.maxUsers - licenseCheck.currentCount;
      if (rows.length > remaining) {
        return NextResponse.json({
          error: `Cannot invite ${rows.length} users. Plan allows ${licenseCheck.maxUsers} total (${remaining} slots remaining).`,
        }, { status: 403 });
      }
    }

    // Validate all rows first
    const errors: { row: number; error: string }[] = [];
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const seenEmails = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // 1-indexed + header row

      if (!row.first_name || !row.last_name) {
        errors.push({ row: rowNum, error: "first_name and last_name are required" });
        continue;
      }

      if (!row.email || !emailRegex.test(row.email)) {
        errors.push({ row: rowNum, error: `Invalid email: ${row.email || "(empty)"}` });
        continue;
      }

      const emailLower = row.email.toLowerCase();
      if (seenEmails.has(emailLower)) {
        errors.push({ row: rowNum, error: `Duplicate email in CSV: ${row.email}` });
        continue;
      }
      seenEmails.add(emailLower);

      if (!row.role || !VALID_ROLES.includes(row.role)) {
        errors.push({ row: rowNum, error: `Invalid role: ${row.role || "(empty)"}. Must be one of: ${VALID_ROLES.join(", ")}` });
        continue;
      }

      // Check existing user in DB
      const [existing] = await db
        .select({ id: schema.appUsers.id })
        .from(schema.appUsers)
        .where(eq(schema.appUsers.email, emailLower))
        .limit(1);

      if (existing) {
        errors.push({ row: rowNum, error: `User with email ${row.email} already exists` });
      }
    }

    // If there are validation errors, return them all without creating any users
    if (errors.length > 0) {
      return NextResponse.json({ created: 0, errors }, { status: 400 });
    }

    // All rows valid — create users
    const supabaseAdmin = createAdminClient();
    let created = 0;
    const processErrors: { row: number; error: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      const emailLower = row.email.toLowerCase();
      const displayName = `${row.first_name} ${row.last_name}`;
      const username = emailLower.split("@")[0].replace(/[^a-zA-Z0-9._-]/g, "").toLowerCase();

      try {
        // Create Supabase auth user without password
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
          email: emailLower,
          email_confirm: true,
        });

        if (authError || !authData.user) {
          processErrors.push({ row: rowNum, error: `Auth error: ${authError?.message || "Unknown"}` });
          continue;
        }

        // Create app_users row
        const [appUser] = await db
          .insert(schema.appUsers)
          .values({
            organizationId: getOrgId(user),
            username,
            displayName,
            email: emailLower,
            passwordHash: "",
            role: row.role,
            supabaseAuthId: authData.user.id,
          })
          .returning();

        // Generate invite
        const token = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        await db.insert(schema.userInvites).values({
          appUserId: appUser.id,
          token,
          email: emailLower,
          expiresAt,
        });

        await sendInviteEmail(emailLower, token, displayName);

        created++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        processErrors.push({ row: rowNum, error: msg });
      }
    }

    // Audit log
    await auditLog({
      organizationId: user.organizationId,
      entityType: "appUser",
      entityId: 0,
      action: "bulk_invite",
      newValue: JSON.stringify({ created, errors: processErrors.length }),
      actorEmail: user.username,
    });

    return NextResponse.json({ created, errors: processErrors });
  } catch (err: unknown) {
    const message = safeError(err, "Failed to process bulk invite");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
