import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { safeError } from "@/lib/errors";
import { reportError } from "@/lib/monitoring";
import { checkLoginRate } from "@/lib/rate-limit-middleware";
import { auditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

function getClientIP(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(req: NextRequest) {
  try {
    // IP-based rate limiting
    const rateLimited = await checkLoginRate(req);
    if (rateLimited) return rateLimited;

    const body = await req.json();
    const { username, password } = body;
    const ip = getClientIP(req);

    if (!username || !password) {
      return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
    }

    // Look up the app user to get their email for Supabase Auth
    const [appUser] = await db
      .select()
      .from(schema.appUsers)
      .where(and(eq(schema.appUsers.username, username), eq(schema.appUsers.isActive, true)))
      .limit(1);

    if (!appUser || !appUser.supabaseAuthId) {
      await auditLog({
        organizationId: 1,
        entityType: "auth",
        entityId: 0,
        action: "login_failure",
        newValue: JSON.stringify({ username, ip, reason: "user_not_found" }),
        actorEmail: username,
      });
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Use the email associated with the Supabase Auth account
    const email = appUser.email || `${username}@provisum.local`;

    // Create a Supabase client that can set cookies on the response
    const response = NextResponse.json({
      success: true,
      user: { id: appUser.id, username: appUser.username, role: appUser.role },
    });

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return req.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options);
            });
          },
        },
      }
    );

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      // Audit log failed attempt
      await auditLog({
        organizationId: appUser.organizationId,
        entityType: "auth",
        entityId: appUser.id,
        action: "login_failure",
        newValue: JSON.stringify({ ip, reason: signInError.message }),
        actorEmail: appUser.email || appUser.username,
      });

      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Audit log successful login
    await auditLog({
      organizationId: appUser.organizationId ?? 1,
      entityType: "auth",
      entityId: appUser.id,
      action: "login_success",
      newValue: JSON.stringify({ ip }),
      actorEmail: appUser.email || appUser.username,
    });

    return response;
  } catch (err: unknown) {
    reportError(err, { source: "login" });
    const message = safeError(err, "Login failed");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
