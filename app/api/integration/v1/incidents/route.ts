/**
 * GET /api/integration/v1/incidents
 *
 * Read-only incident feed for trusted external systems (currently the
 * management-suite tickets feature). Auth: PROVISUM_API_KEY bearer token.
 *
 * Contract is documented in SUPPORT_INTEGRATION.md and was negotiated with
 * the management suite — DO NOT change response field names or shapes
 * without coordinating with that consumer. Breaking changes require a
 * /v2/ route.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq, and, gt, sql } from "drizzle-orm";
import { validateApiKey } from "@/lib/integration-auth";
import { reportError } from "@/lib/monitoring";
import { scrubNullableString, scrubJson } from "@/lib/integration/pii-scrub";
import { SYSTEM_ORG_ID } from "@/lib/incidents/detection";
import { auditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const DEFAULT_LOOKBACK_HOURS = 24;

interface AiClassification {
  category: string;
  rootCause: string;
  suggestedFix: string;
  confidence: number;
  blastRadius: string;
}

interface IncidentResponseRow {
  id: number;
  title: string;
  description: string;
  severity: string;
  status: string;
  source: string;
  sourceRef: string | null;
  aiClassification: AiClassification | null;
  aiTriagedAt: string | null;
  resolution: string | null;
  resolvedBy: number | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  affectedComponent: string | null;
  affectedUsers: number | null;
  metadata: unknown;
  organizationId: number;
  containsPii: boolean;
  createdAt: string;
  updatedAt: string;
}

function safeParseJson<T = unknown>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  if (!validateApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);

    // since: ISO timestamp; defaults to 24h ago
    const sinceParam = url.searchParams.get("since");
    let since: string;
    if (sinceParam) {
      const parsed = new Date(sinceParam);
      if (isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "Invalid 'since' — must be ISO 8601" }, { status: 400 });
      }
      since = parsed.toISOString();
    } else {
      since = new Date(Date.now() - DEFAULT_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
    }

    // limit: 1..MAX_LIMIT, default DEFAULT_LIMIT
    const limitParam = url.searchParams.get("limit");
    let limit = DEFAULT_LIMIT;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (isNaN(parsed) || parsed < 1) {
        return NextResponse.json({ error: "Invalid 'limit' — must be a positive integer" }, { status: 400 });
      }
      limit = Math.min(parsed, MAX_LIMIT);
    }

    // organizationId: optional filter
    const orgIdParam = url.searchParams.get("organizationId");
    let orgFilter: number | null = null;
    if (orgIdParam !== null) {
      const parsed = parseInt(orgIdParam, 10);
      if (isNaN(parsed)) {
        return NextResponse.json({ error: "Invalid 'organizationId'" }, { status: 400 });
      }
      orgFilter = parsed;
    }

    // Pull limit+1 so we can compute hasMore without a second query.
    const conditions = [gt(schema.incidents.updatedAt, since)];
    if (orgFilter !== null) {
      conditions.push(eq(schema.incidents.organizationId, orgFilter));
    }

    const rows = await db
      .select({
        id: schema.incidents.id,
        title: schema.incidents.title,
        description: schema.incidents.description,
        severity: schema.incidents.severity,
        status: schema.incidents.status,
        source: schema.incidents.source,
        sourceRef: schema.incidents.sourceRef,
        aiClassification: schema.incidents.aiClassification,
        aiTriagedAt: schema.incidents.aiTriagedAt,
        resolution: schema.incidents.resolution,
        resolvedBy: schema.incidents.resolvedBy,
        resolvedByName: schema.appUsers.displayName,
        resolvedAt: schema.incidents.resolvedAt,
        affectedComponent: schema.incidents.affectedComponent,
        affectedUsers: schema.incidents.affectedUsers,
        metadata: schema.incidents.metadata,
        organizationId: schema.incidents.organizationId,
        createdAt: schema.incidents.createdAt,
        updatedAt: schema.incidents.updatedAt,
      })
      .from(schema.incidents)
      .leftJoin(schema.appUsers, eq(schema.appUsers.id, schema.incidents.resolvedBy))
      .where(and(...conditions))
      .orderBy(sql`${schema.incidents.updatedAt} ASC`, schema.incidents.id)
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const incidents: IncidentResponseRow[] = page.map((r) => {
      // Scrub free-text fields, metadata JSON, and AI-generated text. The AI
      // prompt sees the full incident description, so its rootCause /
      // suggestedFix can paraphrase user-supplied PII back out.
      const desc = scrubNullableString(r.description);
      const res = scrubNullableString(r.resolution);
      const meta = scrubJson(safeParseJson(r.metadata));
      const ai = scrubJson(safeParseJson<AiClassification>(r.aiClassification));

      const containsPii = desc.hadMatch || res.hadMatch || meta.hadMatch || ai.hadMatch;

      return {
        id: r.id,
        title: r.title, // titles are AI/system-generated — no scrub
        description: desc.value ?? "",
        severity: r.severity,
        status: r.status,
        source: r.source,
        sourceRef: r.sourceRef,
        aiClassification: ai.value as AiClassification | null,
        aiTriagedAt: r.aiTriagedAt,
        resolution: res.value,
        resolvedBy: r.resolvedBy,
        resolvedByName: r.resolvedByName ?? null,
        resolvedAt: r.resolvedAt,
        affectedComponent: r.affectedComponent,
        affectedUsers: r.affectedUsers,
        metadata: meta.value,
        organizationId: r.organizationId,
        containsPii,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    });

    // nextSince = the last row's updatedAt, so the consumer can resume from there.
    // If empty, echo back the same `since` they sent.
    const nextSince = incidents.length > 0 ? incidents[incidents.length - 1].updatedAt : since;

    // SOC 2 / CC6.1 — record every external read so an auditor can answer
    // "who pulled what when". Awaited so audit failures fail the request.
    await auditLog({
      organizationId: orgFilter ?? SYSTEM_ORG_ID,
      entityType: "integration",
      entityId: 0,
      action: "incidents.read",
      newValue: JSON.stringify({
        since,
        limit,
        organizationId: orgFilter,
        returned: incidents.length,
        hasMore,
      }),
      actorEmail: "mgmt-suite@integration",
    });

    return NextResponse.json({
      incidents,
      pageInfo: {
        hasMore,
        nextSince,
      },
      _meta: {
        systemOrgId: SYSTEM_ORG_ID,
      },
    });
  } catch (err) {
    reportError(err instanceof Error ? err : new Error(String(err)), {
      route: "GET /api/integration/v1/incidents",
    });
    return NextResponse.json({ error: "Failed to fetch incidents" }, { status: 500 });
  }
}
