import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { safeError } from "@/lib/errors";
import { getSessionUser } from "@/lib/auth";
import { checkAIRate } from "@/lib/rate-limit-middleware";
import { MAPPER_ROLES } from "@/lib/constants";
import { waitUntil } from "@vercel/functions";
import { auditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !(MAPPER_ROLES as readonly string[]).includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const rateLimited = await checkAIRate(req, String(user.id));
  if (rateLimited) return rateLimited;

  const [job] = await db.insert(schema.processingJobs).values({
    jobType: "end_user_mapping",
    status: "running",
    startedAt: new Date().toISOString(),
  }).returning();

  const promise = (async () => {
    try {
      // Get all persona-target role mappings
      const personaMappings = await db
        .select({
          personaId: schema.personaTargetRoleMappings.personaId,
          targetRoleId: schema.personaTargetRoleMappings.targetRoleId,
        })
        .from(schema.personaTargetRoleMappings)
        .where(eq(schema.personaTargetRoleMappings.isActive, true));

      if (personaMappings.length === 0) {
        throw new Error("No persona-target role mappings found. Run target role mapping first.");
      }

      // Get all user-persona assignments
      const userAssignments = await db
        .select({
          userId: schema.userPersonaAssignments.userId,
          personaId: schema.userPersonaAssignments.personaId,
        })
        .from(schema.userPersonaAssignments);

      if (userAssignments.length === 0) {
        throw new Error("No user-persona assignments found. Run persona assignment first.");
      }

      // Build persona -> target roles map
      const personaRoleMap = new Map<number, number[]>();
      for (const m of personaMappings) {
        const existing = personaRoleMap.get(m.personaId) ?? [];
        existing.push(m.targetRoleId);
        personaRoleMap.set(m.personaId, existing);
      }

      // Pre-load all existing assignments for fast lookup
      const allExisting = await db.select().from(schema.userTargetRoleAssignments);
      const existingMap = new Map<string, typeof allExisting[0]>();
      for (const a of allExisting) {
        existingMap.set(`${a.userId}-${a.targetRoleId}`, a);
      }

      // Create user-target role assignments, detect override preservation
      let created = 0;
      let overridesPreserved = 0;
      const now = new Date().toISOString();

      for (const ua of userAssignments) {
        if (!ua.personaId) continue;
        const targetRoleIds = personaRoleMap.get(ua.personaId) ?? [];
        for (const targetRoleId of targetRoleIds) {
          const key = `${ua.userId}-${targetRoleId}`;
          const existing = existingMap.get(key);

          if (!existing) {
            await db.insert(schema.userTargetRoleAssignments)
              .values({
                userId: ua.userId,
                targetRoleId,
                derivedFromPersonaId: ua.personaId,
                assignmentType: "persona_default",
                status: "draft",
              });
            created++;
          } else if (existing.assignmentType === "individual_override") {
            // Persona mapping pushed but individual override exists — flag it
            await db.update(schema.userTargetRoleAssignments)
              .set({ personaMappingChangedAt: now })
              .where(eq(schema.userTargetRoleAssignments.id, existing.id));
            overridesPreserved++;
          }
        }
      }

      await db.update(schema.processingJobs).set({
        status: "completed",
        totalRecords: userAssignments.length,
        processed: created,
        completedAt: new Date().toISOString(),
      }).where(eq(schema.processingJobs.id, job.id));

      await auditLog({
        organizationId: user.organizationId,
        entityType: "processingJob",
        entityId: job.id,
        action: "end_user_mapping_completed",
        actorEmail: user.email ?? user.username,
        newValue: JSON.stringify({ usersProcessed: userAssignments.length, assignmentsCreated: created, overridesPreserved }),
      });

      return {
        jobId: job.id,
        usersProcessed: userAssignments.length,
        assignmentsCreated: created,
      };
    } catch (err: unknown) {
      const message = safeError(err, "Unknown error");
      await db.update(schema.processingJobs).set({
        status: "failed",
        errorLog: message,
        completedAt: new Date().toISOString(),
      }).where(eq(schema.processingJobs.id, job.id));

      throw err;
    }
  })();

  waitUntil(promise.catch(() => {}));

  try {
    const result = await promise;
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = safeError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
