"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, Shield, TrendingUp, TrendingDown, Users, ShieldCheck, ArrowUpDown, GitCompareArrows } from "lucide-react";
import type { AggregateRiskAnalysis } from "@/lib/queries";
import { cn } from "@/lib/utils";

export interface PolicyDriftAlert {
  id: number;
  targetRoleId: number | null;
  roleName: string;
  roleExternalId: string | null;
  detail: string;
  affectedMappingCount: number | null;
  detectedAt: string;
}

interface Props {
  risk: AggregateRiskAnalysis;
  policyDrift?: PolicyDriftAlert[];
}

function riskLevel(value: number, thresholds: [number, number]): "low" | "medium" | "high" {
  if (value <= thresholds[0]) return "low";
  if (value <= thresholds[1]) return "medium";
  return "high";
}

function RiskBadge({ level }: { level: "low" | "medium" | "high" }) {
  const styles = {
    low: "bg-emerald-100 text-emerald-700 border-emerald-200",
    medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
    high: "bg-red-100 text-red-700 border-red-200",
  };
  return (
    <Badge variant="outline" className={styles[level]}>
      {level.charAt(0).toUpperCase() + level.slice(1)} Risk
    </Badge>
  );
}

export function RiskAnalysisClient({ risk, policyDrift = [] }: Props) {
  const [showAdoptionDrill, setShowAdoptionDrill] = useState(false);
  const [adoptionFilter, setAdoptionFilter] = useState<"all" | "gained" | "reduced">("all");
  const router = useRouter();

  const bcLevel = riskLevel(risk.businessContinuity.usersAtRisk, [5, 20]);
  const adoptionLevel = riskLevel(risk.adoption.usersWithNewAccess + risk.adoption.usersWithReducedAccess, [10, 30]);
  const accessLevel = riskLevel(risk.incorrectAccess.flaggedUsers, [3, 10]);
  const integrityLevel = riskLevel(risk.roleIntegrity.rolesWithViolations, [0, 3]);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Business Continuity */}
        <Card className={bcLevel === "high" ? "border-red-200" : bcLevel === "medium" ? "border-yellow-200" : ""}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-orange-500" />
                Business Continuity
              </CardTitle>
              <RiskBadge level={bcLevel} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Users who may lose access to capabilities they need after migration.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-2xl font-bold tabular-nums">{risk.businessContinuity.usersAtRisk}</p>
                <p className="text-xs text-muted-foreground">Users at risk (&lt;90% coverage)</p>
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums">{risk.businessContinuity.avgCoverage}%</p>
                <p className="text-xs text-muted-foreground">Avg permission coverage</p>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {risk.businessContinuity.totalUncoveredPerms} total uncovered permissions
            </div>
          </CardContent>
        </Card>

        {/* Adoption Risk */}
        <Card className={`${adoptionLevel === "high" ? "border-red-200" : adoptionLevel === "medium" ? "border-yellow-200" : ""} cursor-pointer hover:shadow-md transition-shadow`}
          onClick={() => setShowAdoptionDrill(true)}
        >
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <ArrowUpDown className="h-4 w-4 text-blue-500" />
                Permission Changes
              </CardTitle>
              <RiskBadge level={adoptionLevel} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Users with significant permission changes between source and target systems.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center gap-1">
                  <TrendingUp className="h-3 w-3 text-blue-500" />
                  <p className="text-2xl font-bold tabular-nums">{risk.adoption.usersWithNewAccess}</p>
                </div>
                <p className="text-xs text-muted-foreground">Gaining access (&gt;10 new)</p>
              </div>
              <div>
                <div className="flex items-center gap-1">
                  <TrendingDown className="h-3 w-3 text-orange-500" />
                  <p className="text-2xl font-bold tabular-nums">{risk.adoption.usersWithReducedAccess}</p>
                </div>
                <p className="text-xs text-muted-foreground">Losing access (&gt;10 lost)</p>
              </div>
            </div>
            {risk.adoption.adoptionUserList.length > 0 && (
              <p className="text-xs text-blue-600 font-medium">Click to drill down →</p>
            )}
          </CardContent>
        </Card>

        {/* Incorrect Access */}
        <Card className={accessLevel === "high" ? "border-red-200" : accessLevel === "medium" ? "border-yellow-200" : ""}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Shield className="h-4 w-4 text-red-500" />
                Incorrect Access
              </CardTitle>
              <RiskBadge level={accessLevel} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Users with both coverage gaps AND active SOD conflicts.
            </p>
            <div>
              <p className="text-2xl font-bold tabular-nums">{risk.incorrectAccess.flaggedUsers}</p>
              <p className="text-xs text-muted-foreground">Flagged users requiring review</p>
            </div>
          </CardContent>
        </Card>

        {/* Role Integrity */}
        <Card className={integrityLevel === "high" ? "border-violet-300" : integrityLevel === "medium" ? "border-violet-200" : ""}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-violet-500" />
                Role Integrity
              </CardTitle>
              <RiskBadge level={integrityLevel} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {risk.roleIntegrity.rolesWithViolations === 0 ? (
              <p className="text-xs text-emerald-600 font-medium">No structural role violations detected.</p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Roles with structural SOD violations embedded in their definition.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-2xl font-bold tabular-nums text-violet-600">{risk.roleIntegrity.rolesWithViolations}</p>
                    <p className="text-xs text-muted-foreground">Compromised Roles</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold tabular-nums">{risk.roleIntegrity.affectedUsers}</p>
                    <p className="text-xs text-muted-foreground">Affected Users</p>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {risk.roleIntegrity.criticalOrHighRoles} critical or high severity
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Policy Drift (#42) — roles whose permission set changed since approval */}
      {policyDrift.length > 0 && (
        <Card className="border-yellow-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                <GitCompareArrows className="h-4 w-4 text-yellow-600" />
                Policy Drift
              </CardTitle>
              <Badge variant="outline" className="bg-yellow-100 text-yellow-700 border-yellow-200">
                {policyDrift.length} role{policyDrift.length === 1 ? "" : "s"} drifted
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              These approved roles have a different permission set than when they were
              approved. Review each change and accept or dismiss it in Security Design.
            </p>
            <div className="space-y-2">
              {policyDrift.map((d) => (
                <div key={d.id} className="rounded-md border p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-foreground">
                      {d.roleName}
                      {d.roleExternalId ? (
                        <span className="ml-1 text-xs text-muted-foreground">({d.roleExternalId})</span>
                      ) : null}
                    </span>
                    {d.affectedMappingCount ? (
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {d.affectedMappingCount} assignment{d.affectedMappingCount === 1 ? "" : "s"} affected
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{d.detail}</p>
                </div>
              ))}
            </div>
            <a
              href="/admin/security-design"
              className="inline-block text-xs text-teal-600 font-medium hover:underline"
            >
              Review in Security Design &rarr;
            </a>
          </CardContent>
        </Card>
      )}

      {/* Analysis Overview */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
            <Users className="h-4 w-4" />
            Analysis Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div className="rounded-md border p-3">
              <p className="text-lg font-bold tabular-nums">{risk.totalUsersAnalyzed}</p>
              <p className="text-xs text-muted-foreground">Users analyzed</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-lg font-bold tabular-nums">{risk.businessContinuity.avgCoverage}%</p>
              <p className="text-xs text-muted-foreground">Avg coverage</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-lg font-bold tabular-nums text-orange-600">{risk.businessContinuity.usersAtRisk}</p>
              <p className="text-xs text-muted-foreground">Below 90% coverage</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-lg font-bold tabular-nums text-red-600">{risk.incorrectAccess.flaggedUsers}</p>
              <p className="text-xs text-muted-foreground">Flagged (gaps + SOD)</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Controls Coverage */}
      {risk.controlsCoverage.acceptedRisks > 0 && (
        <div className="flex items-center gap-2 rounded-md border px-4 py-2.5 text-sm">
          <ShieldCheck className="h-4 w-4 text-teal-600 flex-shrink-0" />
          <span className="text-muted-foreground">
            <strong className="text-foreground">Controls Coverage:</strong>{" "}
            {risk.controlsCoverage.withControls} of {risk.controlsCoverage.acceptedRisks} accepted risks have documented compensating controls
          </span>
          {risk.controlsCoverage.withoutControls > 0 && (
            <a href="/sod?status=risk_accepted" className="ml-auto text-xs text-teal-600 font-medium hover:underline whitespace-nowrap">
              View gaps &rarr;
            </a>
          )}
        </div>
      )}

      {/* Permission Changes Drill-Down Dialog */}
      <Dialog open={showAdoptionDrill} onOpenChange={setShowAdoptionDrill}>
        <DialogContent className="sm:max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Permission Changes — Source vs Target</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Users with significant permission changes between source and target systems. New access represents target permissions not present in the source; removed represents source permissions not carried forward. Since source and target use different permission models, high removal counts typically indicate the user was over-provisioned in the source system.
          </p>

          {/* Filter tabs */}
          <div className="flex gap-2 mt-2">
            {(["all", "gained", "reduced"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setAdoptionFilter(f)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  adoptionFilter === f
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {f === "all" ? `All (${risk.adoption.adoptionUserList.length})` :
                 f === "gained" ? `Gaining (${risk.adoption.adoptionUserList.filter(u => u.direction === "gained" || u.direction === "both").length})` :
                 `Reduced (${risk.adoption.adoptionUserList.filter(u => u.direction === "reduced" || u.direction === "both").length})`}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto mt-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">User</th>
                  <th className="pb-2 pr-3 font-medium">Department</th>
                  <th className="pb-2 pr-3 font-medium">Persona</th>
                  <th className="pb-2 pr-3 font-medium text-right">Source Perms</th>
                  <th className="pb-2 pr-3 font-medium text-right">Continued</th>
                  <th className="pb-2 pr-3 font-medium text-right">New Access</th>
                  <th className="pb-2 pr-3 font-medium text-right">Removed</th>
                  <th className="pb-2 font-medium">Net Change</th>
                </tr>
              </thead>
              <tbody>
                {risk.adoption.adoptionUserList
                  .filter((u) =>
                    adoptionFilter === "all" ? true :
                    adoptionFilter === "gained" ? (u.direction === "gained" || u.direction === "both") :
                    (u.direction === "reduced" || u.direction === "both")
                  )
                  .slice(0, 100)
                  .map((u) => {
                    const net = u.newPermCount - u.lostPermCount;
                    return (
                      <tr key={u.userId} className="border-b last:border-0 hover:bg-muted/50 cursor-pointer" onClick={() => router.push(`/users/${u.userId}`)}>
                        <td className="py-2 pr-3 font-medium">{u.userName}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{u.department ?? "—"}</td>
                        <td className="py-2 pr-3">
                          {u.personaName ? (
                            <Badge variant="outline" className="text-[10px] font-normal">{u.personaName}</Badge>
                          ) : "—"}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{u.sourcePermCount}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {u.continuedPermCount > 0 ? (
                            <span className="text-emerald-600 font-medium">{u.continuedPermCount}</span>
                          ) : "0"}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {u.newPermCount > 0 ? (
                            <span className="text-blue-600 font-medium">+{u.newPermCount}</span>
                          ) : "0"}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {u.lostPermCount > 0 ? (
                            <span className="text-orange-600 font-medium">-{u.lostPermCount}</span>
                          ) : "0"}
                        </td>
                        <td className="py-2">
                          <Badge variant="outline" className={`text-[10px] ${
                            net > 0 ? "border-blue-200 text-blue-700"
                            : net < 0 ? "border-orange-200 text-orange-700"
                            : "border-zinc-200 text-zinc-500"
                          }`}>
                            {net > 0 ? `↑ +${net} net` : net < 0 ? `↓ ${net} net` : "No net change"}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            {risk.adoption.adoptionUserList.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">
                No users with significant permission changes detected.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Flagged Users Table */}
      {risk.incorrectAccess.flaggedUserList.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              Flagged Users ({risk.incorrectAccess.flaggedUserList.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">
              Users with both uncovered source permissions and active SOD conflicts. These require immediate review.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">User</th>
                    <th className="pb-2 pr-4 font-medium">Department</th>
                    <th className="pb-2 pr-4 font-medium text-right">Coverage</th>
                    <th className="pb-2 pr-4 font-medium text-right">Uncovered</th>
                    <th className="pb-2 pr-4 font-medium text-right">New Perms</th>
                    <th className="pb-2 font-medium text-right">SOD Conflicts</th>
                  </tr>
                </thead>
                <tbody>
                  {risk.incorrectAccess.flaggedUserList.map((u) => (
                    <tr key={u.userId} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="py-2 pr-4 font-medium">{u.userName}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{u.department ?? "—"}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        <span className={cn("inline-flex items-center gap-1", u.coveragePercent < 80 ? "text-red-600 font-medium" : u.coveragePercent < 90 ? "text-orange-600" : "")}>
                          {u.coveragePercent < 80 && <AlertTriangle className="h-3 w-3" />}
                          {u.coveragePercent}%
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        <span className={cn("inline-flex items-center gap-1", u.uncoveredPermCount > 0 ? "text-orange-600" : "")}>
                          {u.uncoveredPermCount > 0 && <Shield className="h-3 w-3" />}
                          {u.uncoveredPermCount}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">{u.newPermCount}</td>
                      <td className="py-2 text-right">
                        <Badge variant="destructive" className="text-xs tabular-nums inline-flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          {u.sodConflictCount}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
