/**
 * Incident Detection Engine
 *
 * Detects incidents from various sources (health checks, job failures,
 * webhook failures, Sentry, manual reports). Deduplicates, persists,
 * triggers AI triage, and notifies admins.
 */

import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq, and, gte } from "drizzle-orm";
import { reportError } from "@/lib/monitoring";
import { notifyUsersWithRoles } from "@/lib/notifications";
import { triageIncident } from "@/lib/incidents/triage";

type Severity = "critical" | "high" | "medium" | "low";
type IncidentSource = "sentry" | "health_check" | "job_failure" | "webhook_failure" | "manual" | "sod_monitor";

interface DetectIncidentParams {
  title: string;
  description: string;
  severity: Severity;
  source: IncidentSource;
  sourceRef?: string;
  affectedComponent?: string;
  affectedUsers?: number;
  metadata?: Record<string, unknown>;
  organizationId?: number;
}

/**
 * Create an incident after deduplication checks.
 * Returns the incident ID (existing or new).
 */
// Reserved organization id for platform-level incidents that have no real
// tenant context (health checks, job-runner failures, webhook failures).
// Backed by the `__system__` row inserted via migration
// add_system_org_for_platform_incidents.
export const SYSTEM_ORG_ID = 0;

export async function detectIncident(params: DetectIncidentParams): Promise<number> {
  try {
    const orgId = params.organizationId ?? SYSTEM_ORG_ID;

    // --- Dedup check ---
    // 1. Same source + sourceRef (exact match)
    if (params.sourceRef) {
      const [existing] = await db
        .select({ id: schema.incidents.id })
        .from(schema.incidents)
        .where(
          and(
            eq(schema.incidents.source, params.source),
            eq(schema.incidents.sourceRef, params.sourceRef),
          ),
        );
      if (existing) return existing.id;
    }

    // 2. Same title within last 5 minutes
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const [recentDupe] = await db
      .select({ id: schema.incidents.id })
      .from(schema.incidents)
      .where(
        and(
          eq(schema.incidents.title, params.title),
          gte(schema.incidents.createdAt, fiveMinAgo),
        ),
      );
    if (recentDupe) return recentDupe.id;

    // --- Insert new incident ---
    const [incident] = await db
      .insert(schema.incidents)
      .values({
        title: params.title,
        description: params.description,
        severity: params.severity,
        source: params.source,
        sourceRef: params.sourceRef ?? null,
        affectedComponent: params.affectedComponent ?? null,
        affectedUsers: params.affectedUsers ?? null,
        metadata: params.metadata ? JSON.stringify(params.metadata) : null,
        organizationId: orgId,
      })
      .returning({ id: schema.incidents.id });

    const incidentId = incident.id;

    // --- AI triage (fire-and-forget) ---
    triageIncident(incidentId).catch((err) => {
      reportError(err, { context: "triageIncident-fireAndForget", incidentId });
    });

    // --- Notify admins ---
    const severityEmoji =
      params.severity === "critical" ? "[CRITICAL]" :
      params.severity === "high" ? "[HIGH]" :
      params.severity === "medium" ? "[MEDIUM]" : "[LOW]";

    notifyUsersWithRoles({
      roles: ["system_admin", "admin"],
      notificationType: "system",
      subject: `${severityEmoji} Incident: ${params.title}`,
      message: params.description,
      actionUrl: `/admin/incidents`,
    }).catch((err) => {
      reportError(err, { context: "incident-notification", incidentId });
    });

    return incidentId;
  } catch (err) {
    reportError(err, { context: "detectIncident", params });
    // Return -1 to signal failure without crashing the caller
    return -1;
  }
}
