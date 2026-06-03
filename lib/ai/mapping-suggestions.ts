import Anthropic from "@anthropic-ai/sdk";
import { getSetting } from "@/lib/settings";
import { gatewayGenerateText } from "@/lib/ai/gateway-provider";

// ─── Types ───

export interface AIMappingSuggestion {
  targetRoleId: number;
  targetRoleName: string;
  confidence: number; // 0-100
  reasoning: string;
  factors: {
    permissionOverlap: number;
    businessFunctionMatch: boolean;
    nameRelevance: number; // 0-100
    historicalAcceptance: number; // % of similar mappings accepted
  };
}

interface PersonaInput {
  id: number;
  name: string;
  businessFunction: string;
  description: string;
}

interface RoleInput {
  name: string;
  description: string;
  permissions: string[];
}

interface ExistingMappingInput {
  personaName: string;
  targetRoleName: string;
  accepted: boolean;
}

interface OverlapScoreInput {
  targetRoleId: number;
  targetRoleName: string;
  overlapPct: number;
}

// ─── Main Function ───

export async function generateAIMappingSuggestions(
  persona: PersonaInput,
  sourceRoles: RoleInput[],
  targetRoles: RoleInput[],
  existingMappings: ExistingMappingInput[],
  overlapScores: OverlapScoreInput[]
): Promise<AIMappingSuggestion[]> {
  // Gateway adoption (B2 pivot): when ai.mapping_suggestions_via_gateway is "true",
  // route through Vercel AI Gateway for cost tracking + observability. Default false
  // so prod behavior is unchanged until the setting is flipped.
  const viaGateway = (await getSetting("ai.mapping_suggestions_via_gateway")) === "true";

  // Resolve API key only when we're NOT going through the gateway (gateway uses OIDC).
  let apiKey: string | undefined;
  if (!viaGateway) {
    apiKey = (await getSetting("ai.apiKey")) || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Anthropic API key not configured");
    }
  }

  const model = (await getSetting("ai.model")) || "claude-sonnet-4-20250514";
  const gatewayModel = (await getSetting("ai.gateway_model")) || "anthropic/claude-sonnet-4.6";

  // Take the top 15 candidates by overlap to keep prompt size reasonable
  const topCandidates = [...overlapScores]
    .sort((a, b) => b.overlapPct - a.overlapPct)
    .slice(0, 15);

  if (topCandidates.length === 0) {
    return [];
  }

  // Build candidate details with permission info
  const candidateDetails = topCandidates.map((c) => {
    const roleInfo = targetRoles.find((r) => r.name === c.targetRoleName);
    return {
      targetRoleId: c.targetRoleId,
      targetRoleName: c.targetRoleName,
      overlapPct: c.overlapPct,
      description: roleInfo?.description || "",
      permissions: roleInfo?.permissions?.slice(0, 20) || [], // limit for prompt size
    };
  });

  // Calculate historical acceptance rates
  const acceptanceByRole = new Map<string, { accepted: number; total: number }>();
  for (const m of existingMappings) {
    const entry = acceptanceByRole.get(m.targetRoleName) || { accepted: 0, total: 0 };
    entry.total++;
    if (m.accepted) entry.accepted++;
    acceptanceByRole.set(m.targetRoleName, entry);
  }

  const systemPrompt = `You are an enterprise security role mapping expert. You analyze personas (groups of users with similar access patterns) and suggest the best target system roles for them.

You consider:
1. Permission overlap percentage (already calculated)
2. Business function alignment — does the target role serve the same business domain?
3. Role naming conventions — do the names suggest a match?
4. Historical patterns — have similar mappings been accepted or rejected before?

Always return valid JSON. No markdown fences, no explanation outside the JSON.`;

  const userPrompt = buildUserPrompt(persona, sourceRoles, candidateDetails, existingMappings, acceptanceByRole);

  let text: string;
  if (viaGateway) {
    const result = await gatewayGenerateText({
      prompt: userPrompt,
      system: systemPrompt,
      model: gatewayModel,
      tags: ["feature:mapping-suggestions", "env:provisum-runtime"],
    });
    text = result.text;
  } else {
    // Legacy direct-Anthropic path. Kept as default for backward compatibility.
    // Flip ai.mapping_suggestions_via_gateway = "true" in settings to migrate this
    // call site onto the Gateway (Engine PRD §13 observability + cost tracking).
    const client = new Anthropic({ apiKey: apiKey! });
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    text = response.content[0]?.type === "text" ? response.content[0].text : "";
  }

  return parseAIResponse(text, topCandidates, acceptanceByRole);
}

// ─── Prompt Builder ───

function buildUserPrompt(
  persona: PersonaInput,
  sourceRoles: RoleInput[],
  candidates: {
    targetRoleId: number;
    targetRoleName: string;
    overlapPct: number;
    description: string;
    permissions: string[];
  }[],
  existingMappings: ExistingMappingInput[],
  acceptanceByRole: Map<string, { accepted: number; total: number }>
): string {
  const sourceRoleSummary = sourceRoles
    .slice(0, 10)
    .map((r) => `- ${r.name}: ${r.description || "No description"} (${r.permissions.length} permissions)`)
    .join("\n");

  const candidateSummary = candidates
    .map((c) => {
      const acceptance = acceptanceByRole.get(c.targetRoleName);
      const acceptStr = acceptance
        ? ` | Historical acceptance: ${Math.round((acceptance.accepted / acceptance.total) * 100)}% (${acceptance.total} mappings)`
        : "";
      return `- ID:${c.targetRoleId} "${c.targetRoleName}" | Overlap: ${c.overlapPct.toFixed(1)}%${acceptStr}\n  Description: ${c.description || "None"}\n  Sample permissions: ${c.permissions.slice(0, 8).join(", ") || "None listed"}`;
    })
    .join("\n");

  const recentFeedback = existingMappings.slice(-20);
  const feedbackSummary =
    recentFeedback.length > 0
      ? recentFeedback
          .map((m) => `- ${m.personaName} → ${m.targetRoleName}: ${m.accepted ? "ACCEPTED" : "REJECTED"}`)
          .join("\n")
      : "No historical feedback available.";

  return `Analyze this persona and rank the candidate target roles.

## Persona
- Name: ${persona.name}
- Business Function: ${persona.businessFunction || "Not specified"}
- Description: ${persona.description || "No description"}

## Source Roles (current system)
${sourceRoleSummary || "No source role details available."}

## Candidate Target Roles (ranked by permission overlap)
${candidateSummary}

## Recent Mapping Feedback (accepted/rejected patterns)
${feedbackSummary}

## Instructions
Return a JSON array of objects, one per candidate, ranked by your recommended confidence (highest first). Each object must have:
- "targetRoleId": number (the ID from above)
- "targetRoleName": string
- "confidence": number 0-100 (your overall recommendation strength)
- "reasoning": string (1-2 sentence explanation)
- "businessFunctionMatch": boolean (does the role align with the persona's business function?)
- "nameRelevance": number 0-100 (how well the role name relates to the persona name/function)

Return ONLY the JSON array. No other text.`;
}

// ─── Response Parser ───

function parseAIResponse(
  text: string,
  overlapScores: OverlapScoreInput[],
  acceptanceByRole: Map<string, { accepted: number; total: number }>
): AIMappingSuggestion[] {
  // Try to extract JSON array from the response
  let parsed: unknown[];
  try {
    // Strip any markdown fences if present
    const cleaned = text.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    // Try to find a JSON array in the text
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        return fallbackSuggestions(overlapScores, acceptanceByRole);
      }
    } else {
      return fallbackSuggestions(overlapScores, acceptanceByRole);
    }
  }

  if (!Array.isArray(parsed)) {
    return fallbackSuggestions(overlapScores, acceptanceByRole);
  }

  const suggestions: AIMappingSuggestion[] = [];

  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;

    const targetRoleId = Number(obj.targetRoleId);
    const targetRoleName = String(obj.targetRoleName || "");
    const aiConfidence = Math.max(0, Math.min(100, Number(obj.confidence) || 0));
    const reasoning = String(obj.reasoning || "No reasoning provided");
    const businessFunctionMatch = Boolean(obj.businessFunctionMatch);
    const nameRelevance = Math.max(0, Math.min(100, Number(obj.nameRelevance) || 0));

    // Find the overlap score for this role
    const overlap = overlapScores.find((o) => o.targetRoleId === targetRoleId);
    const overlapPct = overlap?.overlapPct ?? 0;

    // Historical acceptance
    const acceptance = acceptanceByRole.get(targetRoleName);
    const historicalAcceptance = acceptance && acceptance.total > 0
      ? Math.round((acceptance.accepted / acceptance.total) * 100)
      : 50; // neutral default

    // Composite confidence: blend AI confidence (60%) + overlap (30%) + history (10%)
    const compositeConfidence = Math.round(
      aiConfidence * 0.6 + overlapPct * 0.3 + historicalAcceptance * 0.1
    );

    suggestions.push({
      targetRoleId,
      targetRoleName,
      confidence: Math.max(0, Math.min(100, compositeConfidence)),
      reasoning,
      factors: {
        permissionOverlap: Math.round(overlapPct),
        businessFunctionMatch,
        nameRelevance,
        historicalAcceptance,
      },
    });
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence);
}

// ─── Fallback (if AI parsing fails, use overlap scores only) ───

function fallbackSuggestions(
  overlapScores: OverlapScoreInput[],
  acceptanceByRole: Map<string, { accepted: number; total: number }>
): AIMappingSuggestion[] {
  return overlapScores
    .sort((a, b) => b.overlapPct - a.overlapPct)
    .slice(0, 10)
    .map((o) => {
      const acceptance = acceptanceByRole.get(o.targetRoleName);
      const historicalAcceptance = acceptance && acceptance.total > 0
        ? Math.round((acceptance.accepted / acceptance.total) * 100)
        : 50;
      return {
        targetRoleId: o.targetRoleId,
        targetRoleName: o.targetRoleName,
        confidence: Math.round(o.overlapPct),
        reasoning: `Based on ${o.overlapPct.toFixed(1)}% permission overlap (AI analysis unavailable).`,
        factors: {
          permissionOverlap: Math.round(o.overlapPct),
          businessFunctionMatch: false,
          nameRelevance: 0,
          historicalAcceptance,
        },
      };
    });
}
