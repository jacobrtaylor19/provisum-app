/** Barrel re-export for the B1 matcher + discovery. */

export type { AtomKey, Fingerprint } from "./fingerprint";
export { containment, fingerprintSimilarity, jaccard } from "./fingerprint";

export type {
  MatcherCandidate,
  MatcherInput,
  MatcherOptions,
  MatcherResult,
  PersonaSpec,
} from "./persona-matcher";
export { matchPerson, matchPopulation } from "./persona-matcher";

export type {
  DiscoveredPersona,
  DiscoveryInput,
  DiscoveryOptions,
  DiscoveryResult,
} from "./persona-discovery";
export { discoverPersonas } from "./persona-discovery";
