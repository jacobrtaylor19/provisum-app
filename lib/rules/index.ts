/**
 * Barrel re-export for the rules engine.
 *
 *   import { evaluate, sodRule, leastPrivilegeRule, policyRule } from "@/lib/rules";
 *
 * The "default" rule pack is composed below. Per-engagement packs override or
 * extend it via `getPolicyPackForOrg`.
 */

export type {
  DecisionContext,
  Rule,
  RuleResult,
  RuleSeverity,
  RulesClearance,
} from "./engine";
export { evaluate } from "./engine";

export { sodRule } from "./sod";
export {
  computeLeastPrivilege,
  leastPrivilegeRule,
} from "./least-privilege";
export type {
  LeastPrivilegeInputs,
  LeastPrivilegeResult,
} from "./least-privilege";
export { policyRule, getPolicyPackForOrg } from "./policy";

import { sodRule } from "./sod";
import { leastPrivilegeRule } from "./least-privilege";
import { policyRule } from "./policy";
import type { Rule } from "./engine";

/** Default rule pack composition. Order matters only for audit listings. */
export const DEFAULT_RULE_PACK: readonly Rule[] = [sodRule, leastPrivilegeRule, policyRule];
