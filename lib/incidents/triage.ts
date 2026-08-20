/**
 * AI Triage Agent
 *
 * Uses Claude to classify incidents, identify root causes, and suggest fixes.
 * Updates the incident record with structured AI analysis.
 */

import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { reportError } from "@/lib/monitoring";
import { notifyUsersWithRoles } from "@/lib/notifications";
import Anthropic from "@anthropic-ai/sdk";

interface AIClassification {
  category: string; // auth, database, ai_pipeline, export, integration, performance, security, configuration
  rootCause: string;
  suggestedFix: string;
  confidence: number; // 0-100
  blastRadius: string; // isolated, department, organization, platform
}

/**
 * Run AI triage on an incident.
 * Reads the incident, sends to Claude for analysis, and updates the record.
 */
export async function triageIncident(incidentId: number): Promise<void> {
  try {
    // Read the incident
    const [incident] = await db
      .select()
      .from(schema.incidents)
      .where(eq(schema.incidents.id, incidentId));

    if (!incident) {
      throw new Error(`Incident ${incidentId} not found`);
    }

    // Fetch recent similar incidents for context (last 10)
    const recentIncidents = await db
      .select({
        id: schema.incidents.id,
        title: schema.incidents.title,
        severity: schema.incidents.severity,
        source: schema.incidents.source,
        affectedComponent: schema.incidents.affectedComponent,
        status: schema.incidents.status,
        aiClassification: schema.incidents.aiClassification,
        createdAt: schema.incidents.createdAt,
      })
      .from(schema.incidents)
      .where(sql`${schema.incidents.id} != ${incidentId}`)
      .orderBy(desc(schema.incidents.createdAt))
      .limit(10);

    const recentContext = recentIncidents.length > 0
      ? recentIncidents.map((i) => {
          let classification = "";
          if (i.aiClassification) {
            try {
              const c = JSON.parse(i.aiClassification);
              classification = ` | AI: ${c.category}, confidence=${c.confidence}`;
            } catch { /* ignore */ }
          }
          return `- [${i.severity}] ${i.title} (${i.source}, ${i.status})${classification} — ${i.createdAt}`;
        }).join("\n")
      : "No recent incidents.";

    const metadataStr = incident.metadata
      ? `\nAdditional metadata:\n${incident.metadata}`
      : "";

    const prompt = `You are an incident triage agent for Provisum, an enterprise role mapping platform (Next.js + Supabase Postgres).

Analyze this incident and provide a structured classification.

## Incident Details
- **Title:** ${incident.title}
- **Description:** ${incident.description}
- **Severity:** ${incident.severity}
- **Source:** ${incident.source}
- **Source Reference:** ${incident.sourceRef || "N/A"}
- **Affected Component:** ${incident.affectedComponent || "Unknown"}
- **Affected Users:** ${incident.affectedUsers ?? "Unknown"}${metadataStr}

## Recent Incidents (last 10)
${recentContext}

## Available Remediation Actions
- Restart the health check monitor
- Retry failed jobs via the job runner
- Re-enable disabled webhook endpoints
- Check database connection pool
- Review Sentry error dashboard
- Clear rate limit entries
- Verify API key configuration

## Response Format
Respond with ONLY valid JSON (no markdown, no code blocks) in this exact format:
{
  "category": "<one of: auth, database, ai_pipeline, export, integration, performance, security, configuration>",
  "rootCause": "<1-2 sentence root cause analysis>",
  "suggestedFix": "<specific actionable recommendation>",
  "confidence": <0-100>,
  "blastRadius": "<one of: isolated, department, organization, platform>"
}`;

    // Call Claude
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY not configured — cannot triage incident");
    }

    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 512,
      // Thinking is on by default for this model; with a tight 512-token
      // budget it can consume the whole thing before any text is produced.
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: prompt }],
    });

    // Extract text response
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from Claude");
    }

    // Parse JSON response
    let classification: AIClassification;
    try {
      classification = JSON.parse(textBlock.text);
    } catch {
      // Try to extract JSON from the response if Claude wrapped it
      const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        classification = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error(`Failed to parse AI triage response: ${textBlock.text.slice(0, 200)}`);
      }
    }

    // Validate and clamp confidence
    classification.confidence = Math.max(0, Math.min(100, Math.round(classification.confidence)));

    // Update the incident with AI classification
    const now = new Date().toISOString();
    await db
      .update(schema.incidents)
      .set({
        aiClassification: JSON.stringify(classification),
        aiTriagedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.incidents.id, incidentId));

    // If critical severity, send email to admins
    if (incident.severity === "critical") {
      notifyUsersWithRoles({
        roles: ["system_admin", "admin"],
        notificationType: "system",
        subject: `[CRITICAL] AI Triage: ${incident.title}`,
        message: `Root cause: ${classification.rootCause}\n\nSuggested fix: ${classification.suggestedFix}\n\nConfidence: ${classification.confidence}%\nBlast radius: ${classification.blastRadius}`,
        actionUrl: `/admin/incidents`,
      }).catch(() => {});
    }
  } catch (err) {
    reportError(err, { context: "triageIncident", incidentId });
    // Don't rethrow — triage failure shouldn't block the incident pipeline
  }
}
