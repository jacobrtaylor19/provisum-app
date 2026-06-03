import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { getAIProvider } from "@/lib/ai/provider";
import { buildSystemContextPrompt } from "@/lib/ai/system-context";
import { getSetting } from "@/lib/settings";
import { gatewayGenerateText } from "@/lib/ai/gateway-provider";

function buildMappingPrompt(
  persona: { name: string; description: string | null; businessFunction: string | null },
  targetRoles: { roleId: string; roleName: string; description: string | null; domain: string | null }[],
  systemContext?: string
): string {
  return `You are an enterprise security architect applying least-access principles.

${systemContext ? systemContext + "\n" : ""}## Persona
Name: ${persona.name}
Description: ${persona.description || "Not specified"}
Business Function: ${persona.businessFunction || "Not specified"}

## Available Target Roles
${targetRoles.map(r => `- ${r.roleId}: ${r.roleName} — ${r.description || "No description"} [Domain: ${r.domain || "General"}]`).join("\n")}

## Task
Select the MINIMUM set of target roles this persona needs to perform their job function. Apply least-access principles: only include roles that are genuinely required. Do not add "nice to have" roles.

For each selected role, explain why it's necessary.

Respond with ONLY JSON (no markdown):
{
  "mappings": [
    {
      "target_role_id": "string",
      "reason": "string",
      "confidence": "high" | "medium" | "low"
    }
  ],
  "notes": "string — any concerns about coverage gaps or over-provisioning"
}`;
}

interface MappingResult {
  mappings: { target_role_id: string; reason: string; confidence: string }[];
  notes: string;
}

const BATCH_SIZE = 5; // Process 5 personas concurrently

export async function runTargetRoleMapping(jobId: number): Promise<{ personasMapped: number; totalMappings: number }> {
  // Gateway adoption (B2 pivot): when ai.target_role_mapping_via_gateway is "true",
  // route the per-persona ranking through Vercel AI Gateway with feature-specific tags.
  // Default off — falls back to the legacy getAIProvider() path.
  const viaGateway = (await getSetting("ai.target_role_mapping_via_gateway")) === "true";
  const gatewayModel = (await getSetting("ai.gateway_model")) || "anthropic/claude-sonnet-4.6";
  const provider = viaGateway ? null : await getAIProvider();
  const personas = await db.select().from(schema.personas);
  const targetRoles = await db.select().from(schema.targetRoles);

  if (targetRoles.length === 0) {
    throw new Error("No target roles available. Upload target roles first.");
  }

  // Fetch active release's system types for context injection
  const [activeRelease] = await db.select({
    sourceType: schema.releases.defaultSourceSystemType,
    targetType: schema.releases.targetSystemType,
  }).from(schema.releases).where(eq(schema.releases.isActive, true));

  const systemContext = activeRelease
    ? buildSystemContextPrompt(activeRelease.sourceType ?? "SAP_ECC", activeRelease.targetType ?? "SAP_S4HANA")
    : undefined;

  // Find personas that already have manual mappings — skip them
  const existingMappings = await db.select({ personaId: schema.personaTargetRoleMappings.personaId })
    .from(schema.personaTargetRoleMappings);
  const mappedPersonaIds = new Set(existingMappings.map(m => m.personaId));
  const unmappedPersonas = personas.filter(p => !mappedPersonaIds.has(p.id));

  // Update total records for progress tracking
  await db.update(schema.processingJobs).set({
    totalRecords: unmappedPersonas.length,
  }).where(eq(schema.processingJobs.id, jobId));

  let personasMapped = 0;
  let totalMappings = 0;

  // Process only unmapped personas in parallel batches
  for (let i = 0; i < unmappedPersonas.length; i += BATCH_SIZE) {
    const batch = unmappedPersonas.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (persona) => {
        const prompt = buildMappingPrompt(persona, targetRoles, systemContext);
        let text: string;
        if (viaGateway) {
          const result = await gatewayGenerateText({
            prompt,
            model: gatewayModel,
            tags: ["feature:target-role-mapping", "env:provisum-runtime"],
          });
          text = result.text;
        } else {
          text = await provider!.generateText(prompt);
        }
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("no_json");
        const result: MappingResult = JSON.parse(jsonMatch[0]);
        return { persona, result };
      })
    );

    // Write results to DB
    for (const outcome of results) {
      if (outcome.status === "fulfilled") {
        const { persona, result } = outcome.value;
        for (const mapping of result.mappings) {
          const targetRole = targetRoles.find(r => r.roleId === mapping.target_role_id);
          if (!targetRole) continue;

          await db.insert(schema.personaTargetRoleMappings).values({
            personaId: persona.id,
            targetRoleId: targetRole.id,
            mappingReason: mapping.reason,
            confidence: mapping.confidence,
          });
          totalMappings++;
        }
        personasMapped++;
      }
      // Failed personas are silently skipped
    }

    // Update progress after each batch
    await db.update(schema.processingJobs).set({
      processed: personasMapped,
    }).where(eq(schema.processingJobs.id, jobId));
  }

  // Derive user-level target role assignments from persona mappings
  await deriveUserTargetRoleAssignments();

  return { personasMapped, totalMappings };
}

async function deriveUserTargetRoleAssignments(): Promise<void> {
  // For each user with a persona assignment, create target role assignments
  // based on their persona's mappings
  const assignments = await db.select().from(schema.userPersonaAssignments);

  for (const assignment of assignments) {
    if (!assignment.personaId) continue;

    const mappings = await db.select().from(schema.personaTargetRoleMappings)
      .where(eq(schema.personaTargetRoleMappings.personaId, assignment.personaId));

    for (const mapping of mappings) {
      // Check if assignment already exists
      const existing = await db.select().from(schema.userTargetRoleAssignments)
        .where(eq(schema.userTargetRoleAssignments.userId, assignment.userId));
      const alreadyAssigned = existing.find(a => a.targetRoleId === mapping.targetRoleId);

      if (!alreadyAssigned) {
        await db.insert(schema.userTargetRoleAssignments).values({
          userId: assignment.userId,
          targetRoleId: mapping.targetRoleId,
          derivedFromPersonaId: assignment.personaId,
          assignmentType: "persona_default",
          status: "draft",
        });
      }
    }
  }
}
