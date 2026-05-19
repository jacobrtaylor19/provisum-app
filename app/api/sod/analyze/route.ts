import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { runSodAnalysis } from "@/lib/sod/sod-analysis";
import { getSessionUser } from "@/lib/auth";
import { getUserScope } from "@/lib/scope";
import { notifyUsersWithRoles } from "@/lib/notifications";
import { checkAIRate } from "@/lib/rate-limit-middleware";
import { runWithRetry } from "@/lib/job-runner";
import { waitUntil } from "@vercel/functions";
import { dispatchWebhookEvent } from "@/lib/webhooks";
import { auditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (user.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const rateLimited = await checkAIRate(req, String(user.id));
  if (rateLimited) return rateLimited;

  // Capture user scope at enqueue time for job isolation (WORKFLOW.md Note 6)
  const scopedUserIds = await getUserScope(user);

  const [job] = await db.insert(schema.processingJobs).values({
    jobType: "sod_analysis",
    status: "running",
    startedAt: new Date().toISOString(),
    config: JSON.stringify({
      triggeredBy: user.username,
      triggeredByRole: user.role,
      scopedUserIds: scopedUserIds,
    }),
  }).returning();

  // Fire-and-forget with retry: run SOD analysis in background, return job ID immediately.
  let analysisResult: Awaited<ReturnType<typeof runSodAnalysis>>;

  const promise = runWithRetry(
    async () => {
      analysisResult = await runSodAnalysis(scopedUserIds);

      // Update job stats on success (runner handles status + completedAt)
      await db.update(schema.processingJobs).set({
        totalRecords: analysisResult.usersAnalyzed,
        processed: analysisResult.usersAnalyzed,
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
          action: "sod_analysis_completed",
          actorEmail: user.email ?? user.username,
          newValue: JSON.stringify(analysisResult),
        });

        // Dispatch webhook for SOD analysis completion
        const conflictCount = analysisResult?.conflictsFound ?? 0;
        const usersAnalyzed = analysisResult?.usersAnalyzed ?? 0;
        dispatchWebhookEvent("sod.analysis_complete", { conflictCount, usersAnalyzed }).catch(() => {});

        // Notify coordinators and admins about SOD analysis results
        if (conflictCount > 0) {
          await notifyUsersWithRoles({
            roles: ["coordinator", "admin", "system_admin"],
            notificationType: "workflow_event",
            subject: "SOD conflicts detected",
            message: `SOD analysis found ${conflictCount} conflict(s) across ${analysisResult?.usersAnalyzed ?? 0} users analyzed. Review and resolve these conflicts.`,
            actionUrl: "/sod",
          });
        }
      },
    }
  );

  waitUntil(promise);

  // Return immediately — client polls /api/jobs/[id] for status
  return NextResponse.json({ jobId: job.id, status: "running" });
}
