import { requireAuth } from "@/lib/auth";
import { getOrgId } from "@/lib/org-context";
import { getAggregateRiskAnalysis } from "@/lib/queries";
import { getUserScope } from "@/lib/scope";
import { getPendingPolicyDrift } from "@/lib/policy-drift";
import { RiskAnalysisClient } from "./risk-analysis-client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function RiskAnalysisPage() {
  const user = await requireAuth();
  const orgId = getOrgId(user);

  // Scope-aware: non-admins only see their org unit's risk
  const scopedUserIds = await getUserScope(user);
  const [risk, policyDrift] = await Promise.all([
    getAggregateRiskAnalysis(orgId, scopedUserIds),
    getPendingPolicyDrift(orgId),
  ]);

  return <RiskAnalysisClient risk={risk} policyDrift={policyDrift} />;
}
