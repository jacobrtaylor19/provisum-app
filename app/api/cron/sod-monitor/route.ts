import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { runContinuousSodScan } from "@/lib/sod/continuous-monitor";
import { detectPolicyDrift } from "@/lib/policy-drift";
import { reportError, reportMessage } from "@/lib/monitoring";
import { timingSafeEqual } from "crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Continuous Access Governance cron (#43 + #42).
 *
 * Runs per active organization:
 *  - runContinuousSodScan(): read-only SOD re-evaluation on live access → incidents
 *  - detectPolicyDrift(): permission-set drift vs approval baseline → governance alerts
 *
 * Scheduled weekly in vercel.json. Secured by CRON_SECRET (timing-safe comparison),
 * matching app/api/cron/exports/route.ts.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || !authHeader) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const expected = `Bearer ${cronSecret}`;
  const a = Buffer.from(authHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const orgs = await db
      .select({ id: schema.organizations.id, name: schema.organizations.name })
      .from(schema.organizations)
      .where(eq(schema.organizations.isActive, true));

    let totalIncidents = 0;
    let totalDriftAlerts = 0;
    const perOrg: Array<{
      orgId: number;
      newConflicts: number;
      incidentsRaised: number;
      driftAlerts: number;
    }> = [];

    for (const org of orgs) {
      try {
        const sod = await runContinuousSodScan(org.id);
        const drift = await detectPolicyDrift(org.id);
        const driftAlerts = drift.alertsCreated + drift.alertsRefreshed;
        totalIncidents += sod.incidentsRaised;
        totalDriftAlerts += driftAlerts;
        perOrg.push({
          orgId: org.id,
          newConflicts: sod.newConflicts,
          incidentsRaised: sod.incidentsRaised,
          driftAlerts,
        });
      } catch (err) {
        reportError(err, { context: "sod-monitor-org", orgId: org.id });
      }
    }

    reportMessage(
      `Continuous governance scan: ${totalIncidents} SOD incident(s), ${totalDriftAlerts} drift alert(s) across ${orgs.length} org(s)`,
      "info",
    );

    return NextResponse.json({
      orgsScanned: orgs.length,
      incidentsRaised: totalIncidents,
      driftAlerts: totalDriftAlerts,
      perOrg,
    });
  } catch (err) {
    reportError(err, { route: "GET /api/cron/sod-monitor" });
    return NextResponse.json({ error: "Failed to run governance scan" }, { status: 500 });
  }
}
