import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { runPersonaGeneration } from "@/lib/ai/persona-generation";
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

  // Capture user scope at enqueue time for job isolation
  const scopedUserIds = await getUserScope(user);

  const [job] = await db.insert(schema.processingJobs).values({
    jobType: "persona_generation",
    status: "running",
    startedAt: new Date().toISOString(),
    config: JSON.stringify({
      triggeredBy: user.username,
      triggeredByRole: user.role,
      scopedUserIds: scopedUserIds,
    }),
  }).returning();

  // Fire-and-forget with retry: run generation in background, return job ID immediately.
  let generationResult: Awaited<ReturnType<typeof runPersonaGeneration>>;

  const promise = runWithRetry(
    async () => {
      generationResult = await runPersonaGeneration(job.id);

      // Update job stats on success (runner handles status + completedAt)
      await db.update(schema.processingJobs).set({
        totalRecords: generationResult.usersAssigned,
        processed: generationResult.usersAssigned,
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
          action: "persona_generation_completed",
          actorEmail: user.email ?? user.username,
          newValue: JSON.stringify(generationResult),
        });

        const personaCount = generationResult?.personasCreated ?? 0;
        dispatchWebhookEvent("persona.generated", { personaCount, triggeredBy: user.username }).catch(() => {});

        await notifyUsersWithRoles({
          roles: ["coordinator", "admin", "system_admin"],
          notificationType: "workflow_event",
          subject: "Persona generation complete",
          message: `Persona generation finished: ${personaCount} personas created, ${generationResult?.usersAssigned ?? 0} users assigned.`,
          actionUrl: "/personas",
        });
      },
    }
  );

  waitUntil(promise);

  // Return immediately — client polls /api/jobs/[id] for status
  return NextResponse.json({ jobId: job.id, status: "running" });
}
