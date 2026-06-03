/**
 * Learning loop API — structured correction capture (Engine PRD §11, §14, B4).
 *
 * POST  — submit a CorrectionRecord (canonical snapshot + engine output + human decision).
 *         Writes to mapping_feedback with the new B4 columns populated. Existing
 *         accept/reject flow at /api/mapping/ai-suggestions/feedback is unchanged.
 *
 * GET   — query corrections, org-scoped. Filters by verificationStatus, personaId,
 *         engagementId. Returns the canonical snapshot + correction metadata for
 *         each row, suitable for in-session retrieval (Engine PRD §11 "same-session
 *         memory of a mapper's confirmed decisions").
 *
 * Auth: mapper / admin / system_admin / security_architect.
 * Rate-limit: checkAIRate (this is a learning route consumed by AI workflows).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth";
import { getOrgId } from "@/lib/org-context";
import { checkAIRate } from "@/lib/rate-limit-middleware";
import { reportError } from "@/lib/monitoring";
import { auditLog } from "@/lib/audit";
import { buildCorrectionRecord, type CanonicalPersonRecordJson } from "@/lib/learning";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ALLOWED_ROLES = ["mapper", "admin", "system_admin", "security_architect", "compliance_officer"];

interface PostBody {
  personaId: number;
  targetRoleId: number;
  accepted: boolean;
  aiConfidence?: number;
  aiReasoning?: string;
  // Optional structured correction (when set, fills the new B4 columns).
  canonicalRecord?: CanonicalPersonRecordJson;
  engineOutput?: {
    personaId: string | null;
    targetAccessAtomKeys: string[];
    excessToRemoveAtomKeys: string[];
    sodConflictRuleIds: string[];
    compositeConfidence: number | null;
    confidenceComponents: Record<string, number> | null;
    modelVersion: string;
    rulePackVersion: string;
    datasetVersion: string;
  };
  humanDecision?: {
    personaId: string | null;
    targetAccessAtomKeys: string[];
    excessToRemoveAtomKeys: string[];
    sodConflictRuleIds: string[];
    rationale: string | null;
  };
  verificationStatus?: "pending" | "verified" | "rejected";
  weight?: number;
  engagementId?: string;
}

function isValidBody(b: unknown): b is PostBody {
  if (!b || typeof b !== "object") return false;
  const o = b as Record<string, unknown>;
  return typeof o.personaId === "number"
    && typeof o.targetRoleId === "number"
    && typeof o.accepted === "boolean";
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rateLimited = await checkAIRate(req, String(user.id));
  if (rateLimited) return rateLimited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  if (!isValidBody(body)) {
    return NextResponse.json(
      { error: "Body must include personaId, targetRoleId, accepted" },
      { status: 400 },
    );
  }

  const orgId = getOrgId(user);
  const now = new Date().toISOString();

  // If the caller supplied a structured correction, wrap it into the B4 schema.
  let correctionMetadata: object | null = null;
  if (body.canonicalRecord && body.engineOutput && body.humanDecision) {
    const wrapped = buildCorrectionRecord({
      canonicalRecord: body.canonicalRecord,
      engineOutput: body.engineOutput,
      humanDecision: body.humanDecision,
      correctorActor: user.email ?? `user_${user.id}`,
      correctorRole: user.role,
      correctedAt: now,
      verificationStatus: body.verificationStatus,
      weight: body.weight,
      engagementId: body.engagementId,
    });
    correctionMetadata = wrapped.correction_metadata;
  }

  try {
    const [row] = await db.insert(schema.mappingFeedback).values({
      personaId: body.personaId,
      targetRoleId: body.targetRoleId,
      accepted: body.accepted,
      aiConfidence: body.aiConfidence ?? null,
      aiReasoning: body.aiReasoning ?? null,
      createdBy: user.id,
      organizationId: orgId,
      canonicalSnapshot: (body.canonicalRecord as unknown as object) ?? null,
      correctionMetadata,
      verificationStatus: body.verificationStatus ?? "pending",
      weight: body.weight ?? (body.accepted ? 1.0 : 2.0),
      engagementId: body.engagementId ?? null,
    }).returning();

    await auditLog({
      organizationId: orgId,
      entityType: "mapping_feedback",
      entityId: row.id,
      action: body.accepted ? "correction_acknowledge_accept" : "correction_record",
      actorEmail: user.email ?? `user_${user.id}`,
      actorRole: user.role,
      provenance: {
        decisionType: "human",
        rationale: body.humanDecision?.rationale ?? body.aiReasoning ?? undefined,
        versions: body.engineOutput
          ? {
              model: body.engineOutput.modelVersion,
              rulePack: body.engineOutput.rulePackVersion,
              dataset: body.engineOutput.datasetVersion,
            }
          : undefined,
      },
    });

    return NextResponse.json({ ok: true, id: row.id });
  } catch (err) {
    reportError(err instanceof Error ? err : new Error(String(err)), {
      context: "POST /api/learning/corrections",
    });
    return NextResponse.json({ error: "Failed to record correction" }, { status: 500 });
  }
}


export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const orgId = getOrgId(user);
  const sp = req.nextUrl.searchParams;
  const personaIdRaw = sp.get("personaId");
  const verificationStatus = sp.get("verificationStatus");
  const engagementId = sp.get("engagementId");
  const limit = Math.min(parseInt(sp.get("limit") ?? "50", 10) || 50, 200);

  const conditions = [eq(schema.mappingFeedback.organizationId, orgId)];
  if (personaIdRaw) {
    const pid = parseInt(personaIdRaw, 10);
    if (!Number.isFinite(pid)) {
      return NextResponse.json({ error: "personaId must be a number" }, { status: 400 });
    }
    conditions.push(eq(schema.mappingFeedback.personaId, pid));
  }
  if (verificationStatus) {
    conditions.push(eq(schema.mappingFeedback.verificationStatus, verificationStatus));
  }
  if (engagementId) {
    conditions.push(eq(schema.mappingFeedback.engagementId, engagementId));
  }

  try {
    const rows = await db
      .select({
        id: schema.mappingFeedback.id,
        personaId: schema.mappingFeedback.personaId,
        targetRoleId: schema.mappingFeedback.targetRoleId,
        accepted: schema.mappingFeedback.accepted,
        aiConfidence: schema.mappingFeedback.aiConfidence,
        canonicalSnapshot: schema.mappingFeedback.canonicalSnapshot,
        correctionMetadata: schema.mappingFeedback.correctionMetadata,
        verificationStatus: schema.mappingFeedback.verificationStatus,
        weight: schema.mappingFeedback.weight,
        engagementId: schema.mappingFeedback.engagementId,
        createdAt: schema.mappingFeedback.createdAt,
      })
      .from(schema.mappingFeedback)
      .where(and(...conditions))
      .orderBy(desc(schema.mappingFeedback.id))
      .limit(limit);

    return NextResponse.json({ corrections: rows });
  } catch (err) {
    reportError(err instanceof Error ? err : new Error(String(err)), {
      context: "GET /api/learning/corrections",
    });
    return NextResponse.json({ error: "Failed to query corrections" }, { status: 500 });
  }
}
