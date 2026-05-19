import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getOrgId } from "@/lib/org-context";
import { generateEvidencePackage } from "@/lib/exports/evidence-package";
import { emitIntegrityHash } from "@/lib/exports/integrity";
import { db } from "@/db";
import * as schema from "@/db/schema";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ADMIN_ROLES = ["admin", "system_admin"];

// GET — list past evidence package runs
export async function GET() {
  const user = await getSessionUser();
  if (!user || !ADMIN_ROLES.includes(user.role)) {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }
  const orgId = getOrgId(user);
  const runs = await db
    .select()
    .from(schema.evidencePackageRuns)
    .where(schema.evidencePackageRuns.organizationId ? undefined : undefined);
  // Filter by org in app code since we don't have orgScope helper for this table yet
  const filtered = runs.filter((r) => r.organizationId === orgId);
  return NextResponse.json(filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
}

// POST — generate a new evidence package
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !ADMIN_ROLES.includes(user.role)) {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }

  const body = await req.json();
  const framework = body.framework === "soc2_cc6" ? "soc2_cc6" as const : "sox_404" as const;
  const releaseId = body.releaseId ? parseInt(body.releaseId) : undefined;
  const orgId = getOrgId(user);

  const { buffer, stats } = await generateEvidencePackage({
    orgId,
    releaseId,
    framework,
    generatedByUsername: user.username,
  });

  // Record the run (capture ID for hash persistence)
  const [run] = await db.insert(schema.evidencePackageRuns).values({
    organizationId: orgId,
    releaseId: releaseId ?? null,
    generatedByUserId: user.id,
    generatedByUsername: user.username,
    framework,
    status: "completed",
    userCount: stats.userCount,
    personaCount: stats.personaCount,
    assignmentCount: stats.assignmentCount,
    sodConflictCount: stats.sodConflictCount,
  }).returning({ id: schema.evidencePackageRuns.id });

  // Compute and persist SHA-256 content digest.
  // The hash is returned in the X-Content-Hash response header so the
  // downloader can verify the file hasn't been tampered with.
  const { hash } = await emitIntegrityHash(buffer, run?.id);

  const filename = `Provisum_${framework === "sox_404" ? "SOX404" : "SOC2"}_Evidence_${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Content-Hash": `sha256:${hash}`,
      "X-Content-Hash-Algorithm": "sha256",
    },
  });
}
