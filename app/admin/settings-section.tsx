"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, RotateCcw } from "lucide-react";

// -----------------------------------------------
// ProjectSettingsSection
// -----------------------------------------------

export interface SettingsSectionProps {
  settings: Record<string, string>;
  settingsLoading: boolean;
  settingsSaving: boolean;
  settingsMsg: string;
  currentUser: string;
  onUpdateSetting: (key: string, value: string) => void;
  onSaveSettings: (keys: string[]) => void;
}

export function ProjectSettingsSection({
  settings,
  settingsLoading,
  settingsSaving,
  settingsMsg,
  currentUser,
  onUpdateSetting,
  onSaveSettings,
}: SettingsSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Project Settings</CardTitle>
        <p className="text-xs text-muted-foreground">
          Configure project identity displayed throughout the application. Logged in as <span className="font-medium">{currentUser}</span>.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {settingsLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="project-name">Project Name</Label>
                <Input
                  id="project-name"
                  value={settings["project.name"] || ""}
                  onChange={(e) => onUpdateSetting("project.name", e.target.value)}
                  placeholder="Provisum"
                />
                <p className="text-xs text-muted-foreground">Displayed in the sidebar header</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="project-org">Organization Name</Label>
                <Input
                  id="project-org"
                  value={settings["project.organization"] || ""}
                  onChange={(e) => onUpdateSetting("project.organization", e.target.value)}
                  placeholder="Acme Corp"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="source-system">Source System Name</Label>
                <Input
                  id="source-system"
                  value={settings["project.sourceSystem"] || ""}
                  onChange={(e) => onUpdateSetting("project.sourceSystem", e.target.value)}
                  placeholder="SAP ECC"
                />
                <p className="text-xs text-muted-foreground">Shown on upload and mapping pages</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="target-system">Target System Name</Label>
                <Input
                  id="target-system"
                  value={settings["project.targetSystem"] || ""}
                  onChange={(e) => onUpdateSetting("project.targetSystem", e.target.value)}
                  placeholder="S/4HANA"
                />
                <p className="text-xs text-muted-foreground">Shown on upload and mapping pages</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() =>
                  onSaveSettings([
                    "project.name",
                    "project.sourceSystem",
                    "project.targetSystem",
                    "project.organization",
                  ])
                }
                disabled={settingsSaving}
              >
                {settingsSaving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Save Project Settings
              </Button>
              {settingsMsg && <span className="text-xs text-emerald-600">{settingsMsg}</span>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------
// AIConfigSection
// -----------------------------------------------

const aiProviders = [
  { value: "anthropic", label: "Claude (Anthropic)" },
  { value: "azure_openai", label: "Azure OpenAI" },
  { value: "aws_bedrock", label: "AWS Bedrock" },
  { value: "ollama", label: "Ollama (Local)" },
  { value: "none", label: "None (Manual Only)" },
];

const providerNeedsKey = (provider: string) =>
  ["anthropic", "azure_openai", "aws_bedrock"].includes(provider);

const defaultModelForProvider = (provider: string) => {
  switch (provider) {
    case "anthropic":
      return "claude-sonnet-5";
    case "azure_openai":
      return "gpt-4o";
    case "aws_bedrock":
      return "anthropic.claude-sonnet-5";
    case "ollama":
      return "llama3";
    default:
      return "";
  }
};

export function AIConfigSection({
  settings,
  settingsLoading,
  settingsSaving,
  settingsMsg,
  onUpdateSetting,
  onSaveSettings,
}: Omit<SettingsSectionProps, "currentUser">) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">AI Configuration</CardTitle>
        <p className="text-xs text-muted-foreground">Configure the AI provider used for persona generation and role mapping.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {settingsLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>AI Provider</Label>
                <Select
                  value={settings["ai.provider"] || "anthropic"}
                  onValueChange={(v) => {
                    onUpdateSetting("ai.provider", v);
                    if (!settings["ai.model"]) {
                      onUpdateSetting("ai.model", defaultModelForProvider(v));
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {aiProviders.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Model</Label>
                <Input
                  value={settings["ai.model"] || ""}
                  onChange={(e) => onUpdateSetting("ai.model", e.target.value)}
                  placeholder={defaultModelForProvider(settings["ai.provider"] || "anthropic")}
                />
              </div>
              {providerNeedsKey(settings["ai.provider"] || "anthropic") && (
                <div className="space-y-2 sm:col-span-2">
                  <Label>API Key</Label>
                  <Input
                    type="password"
                    value={settings["ai.apiKey"] || ""}
                    onChange={(e) => onUpdateSetting("ai.apiKey", e.target.value)}
                    placeholder="sk-..."
                  />
                  <p className="text-xs text-muted-foreground">
                    Stored in the database. Overrides ANTHROPIC_API_KEY environment variable when set.
                  </p>
                </div>
              )}
              <div className="space-y-2 sm:col-span-2">
                <Label>
                  Confidence Threshold: {settings["ai.confidenceThreshold"] || "85"}%
                </Label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Number(settings["ai.confidenceThreshold"] || "85")}
                  onChange={(e) => onUpdateSetting("ai.confidenceThreshold", e.target.value)}
                  className="w-full accent-primary"
                />
                <p className="text-xs text-muted-foreground">
                  Assignments below this threshold will be flagged for manual review.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() =>
                  onSaveSettings(["ai.provider", "ai.apiKey", "ai.model", "ai.confidenceThreshold"])
                }
                disabled={settingsSaving}
              >
                {settingsSaving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Save AI Configuration
              </Button>
              {settingsMsg && <span className="text-xs text-emerald-600">{settingsMsg}</span>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------
// WorkflowSettingsSection
// -----------------------------------------------

export function WorkflowSettingsSection({
  settings,
  settingsLoading,
  settingsSaving,
  settingsMsg,
  onUpdateSetting,
  onSaveSettings,
}: Omit<SettingsSectionProps, "currentUser">) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Workflow Settings</CardTitle>
        <p className="text-xs text-muted-foreground">Configure approval and risk acceptance workflows.</p>
      </CardHeader>
      <CardContent className="space-y-6">
        {settingsLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <>
            {/* Auto-approve */}
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="auto-approve"
                  checked={settings["workflow.autoApprove"] === "true"}
                  onChange={(e) =>
                    onUpdateSetting("workflow.autoApprove", e.target.checked ? "true" : "false")
                  }
                  className="h-4 w-4 accent-primary"
                />
                <Label htmlFor="auto-approve">
                  Auto-recommend SOD-clean mappings for bulk approval
                </Label>
              </div>
              <p className="text-xs text-muted-foreground ml-7">
                When enabled, SOD-clean mappings with confidence above the threshold will be routed to approvers for bulk review. Approvers still review and confirm — this does not skip the approval step.
              </p>
            </div>

            {/* Approval Mode */}
            <div className="space-y-2">
              <Label>Approval Mode</Label>
              <Select
                value={settings["workflow.approvalMode"] || "single"}
                onValueChange={(v) => onUpdateSetting("workflow.approvalMode", v)}
              >
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Single Approval</SelectItem>
                  <SelectItem value="dual">Dual Approval</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Dual approval requires two separate approvers for each mapping.
              </p>
            </div>

            {/* SOD Risk Acceptance */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">SOD Risk Acceptance by Severity</Label>
              <div className="space-y-2 ml-1">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={false}
                    disabled
                    className="h-4 w-4"
                  />
                  <span className="text-sm text-muted-foreground">
                    Critical — <span className="text-destructive font-medium">Never allowed</span>
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="sod-high"
                    checked={settings["workflow.sodHighRiskAcceptable"] !== "false"}
                    onChange={(e) =>
                      onUpdateSetting(
                        "workflow.sodHighRiskAcceptable",
                        e.target.checked ? "true" : "false"
                      )
                    }
                    className="h-4 w-4 accent-primary"
                  />
                  <Label htmlFor="sod-high" className="font-normal">
                    High — Allow risk acceptance
                  </Label>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="sod-medium"
                    checked={settings["workflow.sodMediumRiskAcceptable"] !== "false"}
                    onChange={(e) =>
                      onUpdateSetting(
                        "workflow.sodMediumRiskAcceptable",
                        e.target.checked ? "true" : "false"
                      )
                    }
                    className="h-4 w-4 accent-primary"
                  />
                  <Label htmlFor="sod-medium" className="font-normal">
                    Medium — Allow risk acceptance
                  </Label>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="sod-low"
                    checked={settings["workflow.sodLowRiskAcceptable"] !== "false"}
                    onChange={(e) =>
                      onUpdateSetting(
                        "workflow.sodLowRiskAcceptable",
                        e.target.checked ? "true" : "false"
                      )
                    }
                    className="h-4 w-4 accent-primary"
                  />
                  <Label htmlFor="sod-low" className="font-normal">
                    Low — Allow risk acceptance
                  </Label>
                </div>
              </div>
            </div>

            {/* Least Access Threshold */}
            <div className="space-y-2">
              <Label>Least Access Excess Threshold (%)</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  className="w-24 h-8 text-sm"
                  value={settings["least_access_threshold"] ?? "30"}
                  onChange={(e) => onUpdateSetting("least_access_threshold", e.target.value)}
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Persona-to-role mappings where excess permissions exceed this percentage will appear in Least Access analysis and trigger inline warnings in Role Mapping. Default: 30%.
              </p>
            </div>

            {/* Re-mapping Queue Behavior */}
            <div className="space-y-2">
              <Label>Re-mapping Queue — Post-Redesign Behavior</Label>
              <div className="space-y-2 ml-1">
                {[
                  { value: "remap_queue", label: "Re-mapping Queue", desc: "Assignments flagged remap_required; mappers manually confirm or reassign" },
                  { value: "auto_transition", label: "Auto-transition", desc: "Assignments automatically re-submitted for SOD analysis using the updated role" },
                  { value: "hold_state", label: "Hold State", desc: "Assignments frozen at current status pending explicit mapper action" },
                ].map((opt) => (
                  <div key={opt.value} className="flex items-start gap-3">
                    <input
                      type="radio"
                      id={`redesign-${opt.value}`}
                      name="postRedesignBehavior"
                      checked={(settings["workflow.postRedesignBehavior"] || "remap_queue") === opt.value}
                      onChange={() => onUpdateSetting("workflow.postRedesignBehavior", opt.value)}
                      className="mt-0.5 h-4 w-4 accent-primary"
                    />
                    <Label htmlFor={`redesign-${opt.value}`} className="font-normal">
                      <span className="font-medium">{opt.label}</span>
                      <p className="text-xs text-muted-foreground">{opt.desc}</p>
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={() =>
                  onSaveSettings([
                    "workflow.autoApprove",
                    "workflow.approvalMode",
                    "workflow.sodCriticalRiskAcceptable",
                    "workflow.sodHighRiskAcceptable",
                    "workflow.sodMediumRiskAcceptable",
                    "workflow.sodLowRiskAcceptable",
                    "least_access_threshold",
                    "workflow.postRedesignBehavior",
                  ])
                }
                disabled={settingsSaving}
              >
                {settingsSaving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Save Workflow Settings
              </Button>
              {settingsMsg && <span className="text-xs text-emerald-600">{settingsMsg}</span>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------
// DemoResetCard
// -----------------------------------------------

export function DemoResetCard() {
  const [resetting, setResetting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [activePack, setActivePack] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => setActivePack(data.active_demo_pack || "default"))
      .catch(() => setActivePack("default"));
  }, []);

  async function handleReset() {
    setResetting(true);
    try {
      const res = await fetch("/api/demo/reset", { method: "POST" });
      if (res.ok) {
        toast.success("Demo environment reset successfully");
        setConfirmOpen(false);
        window.location.reload();
      } else {
        const data = await res.json();
        toast.error(data.error || "Reset failed");
      }
    } catch {
      toast.error("Failed to reset demo environment");
    } finally {
      setResetting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <RotateCcw className="h-4 w-4" />
          Demo Environment
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Active pack:</span>
          <Badge variant="outline" className="font-mono text-xs">{activePack ?? "loading..."}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Reset the demo environment to its initial state. This clears all generated data
          (personas, mappings, SOD conflicts, approvals) and re-seeds from the demo pack.
        </p>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setConfirmOpen(true)}
          disabled={resetting}
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          Reset Demo Environment
        </Button>

        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reset Demo Environment?</DialogTitle>
              <DialogDescription>
                This will delete all generated data and re-seed the database with the
                &quot;{activePack}&quot; demo pack. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={handleReset} disabled={resetting}>
                {resetting ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Resetting...</> : "Reset Now"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
