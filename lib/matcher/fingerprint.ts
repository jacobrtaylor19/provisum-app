/**
 * Fingerprint primitives (Engine PRD §4.2, §7.1).
 *
 * A persona is identified by its access fingerprint — the set of canonical
 * permission atoms a holder of that persona exercises. Two fingerprints with
 * a high Jaccard similarity are the same persona, regardless of name.
 *
 * The atom-key strings handled here are produced by the ml/v2 dataset
 * (action:object@scope_class). The matcher is atom-vocabulary-agnostic.
 */

export type AtomKey = string;
export type Fingerprint = Set<AtomKey>;

/** Jaccard similarity: |A ∩ B| / |A ∪ B|. Symmetric, in [0,1]. */
export function jaccard(a: Fingerprint, b: Fingerprint): number {
  if (a.size === 0 && b.size === 0) return 1.0;
  let intersection = 0;
  a.forEach((x) => {
    if (b.has(x)) intersection++;
  });
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Containment: how much of `subset` is inside `superset` — |subset ∩ superset| / |subset|.
 * In [0,1]. Useful when matching a person's usage against a persona's core_atoms:
 * answers "what fraction of the person's exercised atoms are core-persona atoms?"
 */
export function containment(subset: Fingerprint, superset: Fingerprint): number {
  if (subset.size === 0) return 1.0;
  let inter = 0;
  subset.forEach((x) => {
    if (superset.has(x)) inter++;
  });
  return inter / subset.size;
}

/**
 * Hybrid similarity used by the matcher: weighted blend of Jaccard and the
 * person-into-persona containment. Captures both "we look like each other" and
 * "this person's usage is a subset of the persona's accepted shape."
 */
export function fingerprintSimilarity(
  personUsage: Fingerprint,
  personaCore: Fingerprint,
  options: { jaccardWeight?: number; containmentWeight?: number } = {},
): number {
  const jw = options.jaccardWeight ?? 0.6;
  const cw = options.containmentWeight ?? 0.4;
  return jw * jaccard(personUsage, personaCore) + cw * containment(personUsage, personaCore);
}
