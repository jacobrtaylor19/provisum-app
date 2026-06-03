/**
 * Inference router (Engine PRD §7.4 / §17 phase 3 — "tier and optimize").
 *
 * Routes persona-assignment requests:
 *   - matcher (B1, deterministic, ~17µs, $0) for the clear-majority cases
 *   - reasoning path (Vercel AI Gateway → Claude Sonnet) for the ambiguous tail
 *
 * Rationale (locked 2026-06-03 after OpenAI shut down self-serve FT):
 *   B2 fine-tune is deferred until the B4 flywheel accumulates real correction
 *   data. Until then, the cheapest correct strategy is:
 *     1. matcher's clean-path covers ~99% of cases at zero $ and microsecond latency
 *     2. ambiguous cases go to the gateway reasoning path with tags for cost tracking
 *     3. all decisions get full provenance (model version + rule pack + decision_type)
 *
 * This module is the runtime entry point. Call sites (persona-assignment route,
 * mapping-suggestions route, Lumen tool handlers) call `routePersonaAssignment`
 * instead of going to a single provider directly.
 */

import { matchPerson, type Fingerprint, type PersonaSpec } from "@/lib/matcher";
import { gatewayGenerateText } from "@/lib/ai/gateway-provider";

export type RoutingPath = "matcher" | "reasoning";

export interface RoutingDecision {
  /** Final persona id (null if both paths declined). */
  personaId: string | null;
  /** Which path produced the answer. */
  path: RoutingPath;
  /** Match similarity (matcher) or model confidence (reasoning); [0,1]. */
  confidence: number;
  /** Was the matcher's top hit ambiguous (and thus escalated)? */
  escalated: boolean;
  /** Human-readable explanation for provenance. */
  reason: string;
  /** Set by the reasoning path; empty for matcher-only. */
  modelVersion?: string;
  /** Set by the reasoning path; raw model output for the audit trail. */
  rawModelOutput?: string;
}

export interface RoutePersonaOptions {
  personId: string | number;
  usage: Fingerprint;
  catalog: readonly PersonaSpec[];
  /** Pass-through user id for gateway observability. */
  userId?: string;
  /** Pass-through tags. Defaults to ["feature:persona-assignment"]. */
  tags?: string[];
  /** Bypass the matcher and go straight to reasoning (rare; for QA). */
  forceReasoning?: boolean;
  /** Bypass reasoning even when ambiguous (matcher-only mode for cost-capped runs). */
  matcherOnly?: boolean;
  /** Override the gateway model. Default: "anthropic/claude-sonnet-4.6". */
  model?: string;
  /** Pass-through to the matcher's ambiguity gap threshold. Default 0.10. */
  ambiguityBand?: number;
  /** Pass-through to the matcher's minimum top similarity. Default 0.5. */
  minSimilarity?: number;
}

const DEFAULT_TAGS = ["feature:persona-assignment", "env:provisum-runtime"];
const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";


function _catalogBlock(catalog: readonly PersonaSpec[]): string {
  const parts: string[] = [];
  for (const p of catalog) {
    const atoms = Array.from(p.coreAtoms).sort().join(", ");
    parts.push(
      `  - ${p.id} (${p.label})\n` +
      `      core atoms: ${atoms}`
    );
  }
  return parts.join("\n");
}


function _personBlock(usage: Fingerprint, personId: string | number): string {
  const sorted = Array.from(usage).sort();
  return `Person ${personId}\n  usage (atoms actually exercised): ${sorted.join(", ")}`;
}


const SYSTEM_PROMPT = (
  "You map a person to their correct latent persona. A persona is identified by " +
  "its access fingerprint — the normalized distribution over canonical permission " +
  "atoms a holder of that persona exercises. Output strictly one line of JSON: " +
  `{"persona_id": "<id from the catalog>"}.`
);


function _parsePersonaId(text: string, validIds: Set<string>): string | null {
  if (!text) return null;
  const trimmed = text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  try {
    const obj = JSON.parse(trimmed) as { persona_id?: string };
    if (obj.persona_id && validIds.has(obj.persona_id)) return obj.persona_id;
  } catch { /* fall through */ }
  const m = text.match(/"persona_id"\s*:\s*"([^"]+)"/);
  if (m && validIds.has(m[1])) return m[1];
  // last resort — any id appears as a substring
  const ids = Array.from(validIds).sort((a, b) => b.length - a.length);
  for (const id of ids) {
    if (text.includes(id)) return id;
  }
  return null;
}


/**
 * Route one person to a persona. Matcher first; escalate to reasoning if
 * ambiguous OR if `forceReasoning` is set.
 */
export async function routePersonaAssignment(opts: RoutePersonaOptions): Promise<RoutingDecision> {
  const tags = opts.tags?.length ? opts.tags : DEFAULT_TAGS;

  if (!opts.forceReasoning) {
    const matcherOpts: { ambiguityBand?: number; minSimilarity?: number } = {};
    if (opts.ambiguityBand !== undefined) matcherOpts.ambiguityBand = opts.ambiguityBand;
    if (opts.minSimilarity !== undefined) matcherOpts.minSimilarity = opts.minSimilarity;
    const m = matchPerson({ personId: opts.personId, usage: opts.usage }, opts.catalog, matcherOpts);
    if (!m.ambiguous && m.bestMatch) {
      return {
        personaId: m.bestMatch.persona.id,
        path: "matcher",
        confidence: m.bestMatch.similarity,
        escalated: false,
        reason: m.reason,
      };
    }
    if (opts.matcherOnly) {
      return {
        personaId: m.bestMatch?.persona.id ?? null,
        path: "matcher",
        confidence: m.bestMatch?.similarity ?? 0,
        escalated: false,
        reason: `Matcher-only mode: ${m.reason}`,
      };
    }
  }

  // Reasoning path: route through Vercel AI Gateway.
  const validIds = new Set(opts.catalog.map((p) => p.id));
  const prompt =
    "Candidate personas (catalog):\n" + _catalogBlock(opts.catalog) +
    "\n\n" + _personBlock(opts.usage, opts.personId) +
    "\n\nOutput one line of JSON.";

  const model = opts.model ?? DEFAULT_MODEL;
  const { text } = await gatewayGenerateText({
    prompt,
    system: SYSTEM_PROMPT,
    model,
    user: opts.userId,
    tags,
  });
  const personaId = _parsePersonaId(text, validIds);
  return {
    personaId,
    path: "reasoning",
    confidence: personaId ? 0.85 : 0,    // best-effort proxy until the model emits structured confidence
    escalated: !opts.forceReasoning,
    reason: opts.forceReasoning
      ? "forceReasoning=true; matcher bypassed."
      : `Matcher flagged ambiguity; reasoning path resolved via ${model}.`,
    modelVersion: model,
    rawModelOutput: text,
  };
}
