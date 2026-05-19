import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { runTargetRoleMapping } from "@/lib/ai/target-role-mapping";
import { getSessionUser } from "@/lib/auth";
import { getUserScope } from "@/lib/scope";
import { checkAIRate } from "@/lib/rate-limit-middleware";
import { runWithRetry } from "@/lib/job-runner";
import { waitUntil } from "@vercel/functions";
import { auditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (user.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions. Viewer role cannot invoke mapping operations." }, { status: 403 });
  }

  const rateLimited = await checkAIRate(req, String(user.id));
  if (rateLimited) return rateLimited;

  const scopedUserIds = await getUserScope(user);

  const [job] = await db.insert(schema.processingJobs).values({
    jobType: "target_role_mapping",
    status: "running",
    startedAt: new Date().toISOString(),
    config: JSON.stringify({
      triggeredBy: user.username,
      triggeredByRole: user.role,
      scopedUserIds: scopedUserIds,
    }),
  }).returning();

  // Fire-and-forget with retry: run mapping in background, return job ID immediately.
  let mappingResult: Awaited<ReturnType<typeof runTargetRoleMapping>>;

  const promise = runWithRetry(
    async () => {
      mappingResult = await runTargetRoleMapping(job.id);

      // Update job stats on success (runner handles status + completedAt)
      await db.update(schema.processingJobs).set({
        totalRecords: mappingResult.personasMapped,
        processed: mappingResult.personasMapped,
      }).where(eq(schema.processingJobs.id, job.id));
    },
    {
      jobId: job.id,
      maxRetries: 2,
      onComplete: async () => {
        await auditLog({
          organizationId: user.organizationId,
          entityType: "processingJob",
          entityId: job.id,
          action: "target_role_mapping_completed",
          actorEmail: user.email ?? user.username,
          newValue: JSON.stringify(mappingResult),
        });
      },
    }
  );

  waitUntil(promise);

  return NextResponse.json({ jobId: job.id, status: "running" });
}
