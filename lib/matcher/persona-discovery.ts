/**
 * Persona discovery from population usage fingerprints (Engine PRD §5 Discover, §8.2).
 *
 * "Cluster population usage fingerprints into candidate personas with a support
 * threshold; draft definitions." PRD §8.2: "A persona is real only when a
 * significant group independently shares its fingerprint."
 *
 * Phase 1 implementation: agglomerative-style clustering on Jaccard similarity.
 * Two clusters merge if their representative fingerprints are within a threshold;
 * clusters with fewer than `minSupport` members are labeled as exceptions, not
 * promoted to personas.
 *
 * No external dependencies; the algorithm is O(n²) on the population size which
 * is fine for typical engagement sizes (≤100k). For larger populations the
 * matching path uses the already-discovered catalog and only NEW fingerprints
 * trigger re-discovery.
 */

import type { AtomKey, Fingerprint } from "./fingerprint";
import { jaccard } from "./fingerprint";

export interface DiscoveryInput {
  personId: string | number;
  usage: Fingerprint;
}

export interface DiscoveredPersona {
  /** Stable id assigned at discovery time. The label is a post-hoc concern. */
  id: string;
  /** Members' personIds. */
  memberIds: (string | number)[];
  /** Representative fingerprint — intersection of "almost-always-present" atoms across members. */
  representativeFingerprint: Set<AtomKey>;
  /** All atoms appearing in any member's usage (union). Useful for UI. */
  unionFingerprint: Set<AtomKey>;
  /** Support: number of members. */
  support: number;
}

export interface DiscoveryResult {
  personas: DiscoveredPersona[];
  /** People whose fingerprints did not join a cluster of ≥ minSupport. PRD §8.2 — exceptions, not personas. */
  exceptions: { personId: string | number; usage: Fingerprint }[];
}

export interface DiscoveryOptions {
  /** Minimum cluster size to be promoted to a persona. PRD §8.2 support threshold. */
  minSupport?: number;
  /** Jaccard similarity threshold for two fingerprints to be in the same cluster. */
  similarityThreshold?: number;
  /** Fraction of members that must hold an atom for it to enter the representative fingerprint. */
  representativeQuorum?: number;
}

const DEFAULTS: Required<DiscoveryOptions> = {
  minSupport: 3,
  similarityThreshold: 0.7,
  representativeQuorum: 0.6,
};

function representativeOf(
  members: { usage: Fingerprint }[],
  quorum: number,
): Set<AtomKey> {
  const counts = new Map<AtomKey, number>();
  for (const m of members) {
    m.usage.forEach((a) => counts.set(a, (counts.get(a) ?? 0) + 1));
  }
  const threshold = Math.ceil(members.length * quorum);
  const rep = new Set<AtomKey>();
  counts.forEach((count, atom) => {
    if (count >= threshold) rep.add(atom);
  });
  return rep;
}

function unionOf(members: { usage: Fingerprint }[]): Set<AtomKey> {
  const u = new Set<AtomKey>();
  for (const m of members) m.usage.forEach((a) => u.add(a));
  return u;
}

/**
 * Discover personas from a population. Returns a stable, deterministic result
 * for a given input ordering (sorted by personId).
 */
export function discoverPersonas(
  population: readonly DiscoveryInput[],
  options: DiscoveryOptions = {},
): DiscoveryResult {
  const opts = { ...DEFAULTS, ...options };

  // Sort by personId for determinism, drop people with empty usage (cannot cluster).
  const sorted = [...population]
    .filter((p) => p.usage.size > 0)
    .sort((a, b) => String(a.personId).localeCompare(String(b.personId)));

  // Simple single-pass clustering: for each person, find the existing cluster
  // whose representative Jaccard ≥ similarityThreshold; otherwise spawn a new cluster.
  type Cluster = { rep: Set<AtomKey>; members: DiscoveryInput[] };
  const clusters: Cluster[] = [];
  for (const person of sorted) {
    let placed = false;
    for (const cluster of clusters) {
      if (jaccard(person.usage, cluster.rep) >= opts.similarityThreshold) {
        cluster.members.push(person);
        // Recompute representative after the new member joins (quorum-based).
        cluster.rep = representativeOf(cluster.members, opts.representativeQuorum);
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({ rep: new Set(person.usage), members: [person] });
    }
  }

  const personas: DiscoveredPersona[] = [];
  const exceptions: { personId: string | number; usage: Fingerprint }[] = [];

  clusters.forEach((cluster, idx) => {
    if (cluster.members.length >= opts.minSupport) {
      personas.push({
        id: `DISCOVERED-${String(idx).padStart(4, "0")}`,
        memberIds: cluster.members.map((m) => m.personId),
        representativeFingerprint: representativeOf(cluster.members, opts.representativeQuorum),
        unionFingerprint: unionOf(cluster.members),
        support: cluster.members.length,
      });
    } else {
      // Cluster too small → members are exceptions, NOT a persona (PRD §8.2).
      for (const m of cluster.members) {
        exceptions.push({ personId: m.personId, usage: m.usage });
      }
    }
  });

  // Stable sort: largest cluster first, then by id.
  personas.sort((a, b) => b.support - a.support || a.id.localeCompare(b.id));

  return { personas, exceptions };
}
