/**
 * Lightweight persona matcher (Engine PRD §7.1, §17 phase 1).
 *
 * "A lightweight embedding model places user usage-fingerprints and persona
 * fingerprints in a shared space. A distance score gives a fast, deterministic,
 * cheap persona match for the unambiguous majority of users."
 *
 * Phase 1 implementation: deterministic similarity in atom-key space using the
 * Jaccard + containment blend from `fingerprint.ts`. No ML embedding — the
 * canonical permission space is discrete; set-theoretic similarity captures the
 * signal cleanly and lets B3's router send the unambiguous tail to the matcher
 * without paying for any model call.
 *
 * The matcher is the "scale path" — designed to leave the reasoning model only
 * the cases where (a) the top match's similarity is low (ambiguous) or (b) two
 * matches are close together (genuinely contested).
 */

import type { Fingerprint } from "./fingerprint";
import { fingerprintSimilarity } from "./fingerprint";

export interface PersonaSpec {
  /** Stable id used in audit / mapping records. */
  id: string;
  /** Post-hoc label (PRD §4.2: never the identity). */
  label: string;
  /** Atoms a holder must have. */
  coreAtoms: Fingerprint;
  /** Atoms carried forward only if exercised. */
  optionalAtoms?: Fingerprint;
}

export interface MatcherInput {
  personId: string | number;
  usage: Fingerprint;          // atoms the person actually exercised
  entitlements?: Fingerprint;  // optional — used by least-privilege downstream
}

export interface MatcherCandidate {
  persona: PersonaSpec;
  similarity: number;          // in [0,1]
}

export interface MatcherResult {
  personId: string | number;
  bestMatch: MatcherCandidate | null;
  /** Ranked candidates with similarity. */
  ranked: MatcherCandidate[];
  /** Cheap proxy for fingerprintMatchStrength input on the gate. */
  fingerprintMatchStrength: number;
  /** True if the top two scores are close together — gate should route this to review. */
  ambiguous: boolean;
  /** Reason string suitable for audit provenance. */
  reason: string;
}

export interface MatcherOptions {
  /** Below this, the matcher reports "no confident match" — bestMatch stays the top by score
   *  but ambiguous is true and the engine should escalate to the reasoning path. */
  minSimilarity?: number;
  /** If |top.similarity - second.similarity| <= this, flag as ambiguous. */
  ambiguityBand?: number;
  /** Jaccard vs containment blend. */
  jaccardWeight?: number;
  containmentWeight?: number;
}

const DEFAULT_OPTIONS: Required<MatcherOptions> = {
  minSimilarity: 0.5,
  ambiguityBand: 0.10,
  jaccardWeight: 0.6,
  containmentWeight: 0.4,
};

/** Match one person against a persona catalog. */
export function matchPerson(
  input: MatcherInput,
  catalog: readonly PersonaSpec[],
  options: MatcherOptions = {},
): MatcherResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const ranked: MatcherCandidate[] = catalog
    .map((persona) => ({
      persona,
      similarity: fingerprintSimilarity(input.usage, persona.coreAtoms, {
        jaccardWeight: opts.jaccardWeight,
        containmentWeight: opts.containmentWeight,
      }),
    }))
    .sort((a, b) => b.similarity - a.similarity);

  if (ranked.length === 0) {
    return {
      personId: input.personId,
      bestMatch: null,
      ranked: [],
      fingerprintMatchStrength: 0,
      ambiguous: true,
      reason: "Empty persona catalog.",
    };
  }

  const top = ranked[0];
  const second = ranked[1];
  const gap = second ? top.similarity - second.similarity : 1;
  const ambiguous = top.similarity < opts.minSimilarity || gap <= opts.ambiguityBand;

  let reason: string;
  if (top.similarity < opts.minSimilarity) {
    reason = `Top match similarity ${top.similarity.toFixed(3)} below minSimilarity ${opts.minSimilarity}; route to reasoning model.`;
  } else if (gap <= opts.ambiguityBand) {
    reason = `Top two candidates within ${opts.ambiguityBand} (${top.persona.id}=${top.similarity.toFixed(3)} vs ${second!.persona.id}=${second!.similarity.toFixed(3)}); route to reasoning model.`;
  } else {
    reason = `Clean fingerprint match to ${top.persona.id} (similarity ${top.similarity.toFixed(3)}, gap ${gap.toFixed(3)}).`;
  }

  return {
    personId: input.personId,
    bestMatch: top,
    ranked,
    fingerprintMatchStrength: top.similarity,
    ambiguous,
    reason,
  };
}

/** Convenience: bulk match. */
export function matchPopulation(
  people: readonly MatcherInput[],
  catalog: readonly PersonaSpec[],
  options?: MatcherOptions,
): MatcherResult[] {
  return people.map((p) => matchPerson(p, catalog, options));
}
