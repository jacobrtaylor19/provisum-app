import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ShieldCheck,
  Brain,
  ShieldAlert,
  UserCircle,
  Route,
  BarChart3,
  Layers,
  Scale,
  Eye,
  Wrench,
  ArrowRight,
  CheckCircle,
  Target,
  FileSpreadsheet,
  Users,
  LogIn,
} from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo-mode";
import { DemoGate } from "./demo-gate";

export const dynamic = "force-dynamic";

const personas = [
  {
    username: "demo.admin",
    label: "Admin",
    role: "admin",
    icon: "Wrench",
    color: "bg-slate-700",
    description:
      "Full platform access. Manages users, assignments, releases, system configuration, and exports. Start here for a complete overview.",
    tryFirst: [
      "Dashboard overview & stats",
      "Admin console (config, users, flags)",
      "Create & manage releases",
      "Export audit evidence packages",
    ],
  },
  {
    username: "demo.mapper.finance",
    label: "Mapper (Finance)",
    role: "mapper",
    icon: "Route",
    color: "bg-teal-700",
    description:
      "Responsible for mapping users to target roles within their assigned department. Reviews AI suggestions, refines mappings, and submits for review.",
    tryFirst: [
      "End User Mapping workspace",
      "AI-suggested role mappings",
      "Submit users for review",
      "Calibration queue",
    ],
  },
  {
    username: "demo.approver",
    label: "Approver",
    role: "approver",
    icon: "CheckCircle",
    color: "bg-emerald-700",
    description:
      "Reviews and approves role assignments submitted by mappers. Can send assignments back to draft for rework.",
    tryFirst: [
      "Approvals queue",
      "Review user role details",
      "Approve or reject assignments",
      "SOD conflict visibility",
    ],
  },
  {
    username: "demo.coordinator",
    label: "Coordinator",
    role: "coordinator",
    icon: "Layers",
    color: "bg-blue-700",
    description:
      "Tracks project progress across workstreams. Sends reminders to mappers and approvers. Monitors timelines and deadlines.",
    tryFirst: [
      "Workstream tracker",
      "Send reminder notifications",
      "Release timeline view",
      "Program management overview",
    ],
  },
  {
    username: "demo.pm",
    label: "Project Manager",
    role: "project_manager",
    icon: "Layers",
    color: "bg-indigo-700",
    description:
      "Oversees the full migration program. Manages releases, compares release progress, and monitors cross-workstream health.",
    tryFirst: [
      "Release comparison dashboard",
      "Project timeline",
      "Migration health metrics",
      "Cross-release analytics",
    ],
  },
  {
    username: "demo.viewer",
    label: "Viewer",
    role: "viewer",
    icon: "Eye",
    color: "bg-gray-600",
    description:
      "Read-only access across the platform. Perfect for stakeholders and auditors who need visibility without edit permissions.",
    tryFirst: [
      "Dashboard & reporting",
      "SOD conflict review",
      "Risk analysis page",
      "All data is read-only",
    ],
  },
  {
    username: "demo.security",
    label: "Security Architect",
    role: "security_architect",
    icon: "ShieldCheck",
    color: "bg-orange-700",
    description:
      "Manages target role design and reviews security implications of role mappings. Triages role redesign work items.",
    tryFirst: [
      "Security triage workspace",
      "Target role catalog",
      "Security design admin",
      "Role redesign queue",
    ],
  },
  {
    username: "demo.compliance",
    label: "Compliance Officer",
    role: "compliance_officer",
    icon: "Scale",
    color: "bg-purple-700",
    description:
      "Reviews escalated SOD conflicts and compliance exceptions. Ensures mitigating controls are documented for accepted risks.",
    tryFirst: [
      "Compliance triage workspace",
      "Escalated SOD conflicts",
      "Mitigating controls review",
      "SOD exception documentation",
    ],
  },
];

const keyFeatures = [
  {
    title: "AI-Powered Persona Generation",
    description:
      "Claude analyzes 1,000 source users and clusters them into 20 personas based on permission patterns, business function, and department.",
    icon: Brain,
    path: "/personas",
  },
  {
    title: "Intelligent Role Mapping",
    description:
      "AI suggests target role assignments with confidence scoring. Mappers review, refine, and submit — with full transparency into every decision.",
    icon: Route,
    path: "/mapping",
  },
  {
    title: "SOD Conflict Analysis",
    description:
      "Built-in segregation of duties engine detects between-role and within-role conflicts. Includes escalation, risk acceptance, and mitigating controls.",
    icon: ShieldAlert,
    path: "/sod",
  },
  {
    title: "Risk Analysis & Permission Changes",
    description:
      "Quantified risk scoring, permission change drill-downs showing exactly what access each user is gaining or losing in the migration.",
    icon: BarChart3,
    path: "/risk-analysis",
  },
  {
    title: "Structured Approval Workflow",
    description:
      "Draft → Submit → SOD Check → Approval. Every status change is audited. Approvers see only what's ready for their review.",
    icon: CheckCircle,
    path: "/approvals",
  },
  {
    title: "Audit Evidence Packages",
    description:
      "One-click SOX/ITGC evidence export: cover sheet, control summary, user access matrix, persona assignments, SOD conflicts, approval trail.",
    icon: FileSpreadsheet,
    path: "/admin/evidence-package",
  },
  {
    title: "Target Role Lifecycle",
    description:
      "Draft → approve → archive workflow for target roles. Security architects review AI-generated roles before they enter the mapping pipeline.",
    icon: Target,
    path: "/target-roles",
  },
  {
    title: "Multi-Persona Workspaces",
    description:
      "Security, compliance, mapping, and program management each have dedicated workspaces with scoped views and role-appropriate actions.",
    icon: Users,
    path: "/home",
  },
];

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Wrench,
  Route,
  CheckCircle,
  Layers,
  Eye,
  ShieldCheck,
  Scale,
};

export default async function Home() {
  const user = await getSessionUser();
  if (user) redirect("/home");

  // On production (app.provisum.io), skip the demo overview — go straight to login
  if (!isDemoMode()) redirect("/login");

  return (
    <DemoGate>
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-brand-accent-dark">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="text-lg font-bold text-white tracking-tight">
              Provisum
            </span>
            <span className="ml-2 rounded-full bg-teal-500/20 px-2.5 py-0.5 text-[11px] font-medium text-teal-300">
              Demo Environment
            </span>
          </div>
          <Link
            href="/login"
            className="flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2 text-sm font-medium text-white hover:bg-teal-700 transition-colors"
          >
            <LogIn className="h-4 w-4" />
            Sign In
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-brand-accent-dark px-6 pb-16 pt-12 text-center text-white">
        <h1 className="text-3xl font-bold md:text-4xl">
          Welcome to the Provisum Demo
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-300">
          Explore intelligent role mapping for enterprise migrations. This
          environment is pre-loaded with 1,000 users, 20 AI-generated personas,
          and a complete mapping workflow — ready to explore.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/login"
            className="flex items-center gap-2 rounded-lg bg-teal-600 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-700 transition-colors"
          >
            Sign In to Demo
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* How to Sign In */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <h2 className="text-xl font-bold text-brand-text">
            How to Sign In
          </h2>
          <p className="mt-2 text-sm text-brand-text-muted leading-relaxed">
            On the{" "}
            <Link href="/login" className="text-teal-600 underline underline-offset-2 hover:text-teal-700">
              sign-in page
            </Link>
            , simply click any persona button and your credentials will be
            filled in automatically — just hit Sign In. Each persona gives
            you a different view of the platform based on their role in the
            migration project.
          </p>

          <div className="mt-6 rounded-lg border border-teal-100 bg-teal-50/50 p-5">
            <h3 className="text-sm font-semibold text-teal-800">
              Multiple Demo Environments
            </h3>
            <p className="mt-1.5 text-sm text-teal-700 leading-relaxed">
              The sign-in page includes a demo environment selector with
              pre-configured scenarios for different industries — including SAP
              S/4HANA, Oracle Fusion, Workday, Salesforce, ServiceNow, and more.
              Switch environments at any time to see how Provisum adapts to
              different migration contexts.
            </p>
          </div>
        </div>
      </section>

      {/* Personas */}
      <section className="mx-auto max-w-6xl px-6 pb-16">
        <h2 className="mb-2 text-2xl font-bold text-brand-text">
          Demo Personas
        </h2>
        <p className="mb-8 text-sm text-brand-text-muted">
          Each persona represents a real role in an enterprise migration project.
          Sign in as different users to experience how Provisum adapts to each
          workflow.
        </p>

        <div className="grid gap-5 md:grid-cols-2">
          {personas.map((p) => {
            const Icon = iconMap[p.icon] || UserCircle;
            return (
              <div
                key={p.username}
                className="group relative rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-start gap-4">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${p.color} text-white`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-brand-text">
                        {p.label}
                      </h3>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                        {p.role}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-brand-text-muted font-mono">
                      {p.username}
                    </p>
                    <p className="mt-2 text-sm text-brand-text-muted leading-relaxed">
                      {p.description}
                    </p>
                    <div className="mt-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                        What to try
                      </p>
                      <ul className="space-y-1">
                        {p.tryFirst.map((item) => (
                          <li
                            key={item}
                            className="flex items-start gap-1.5 text-xs text-brand-text-muted"
                          >
                            <CheckCircle className="mt-0.5 h-3 w-3 shrink-0 text-teal-500" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Key Features */}
      <section className="bg-white px-6 py-16">
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-2 text-2xl font-bold text-brand-text">
            Key Features to Explore
          </h2>
          <p className="mb-8 text-sm text-brand-text-muted">
            Provisum covers the full role mapping lifecycle — from AI-powered
            analysis to audit-ready exports.
          </p>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {keyFeatures.map((f) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="rounded-xl border border-slate-100 bg-slate-50 p-5 hover:border-teal-200 hover:bg-teal-50/30 transition-colors"
                >
                  <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 text-teal-700">
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <h3 className="text-sm font-semibold text-brand-text">
                    {f.title}
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-brand-text-muted">
                    {f.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Demo Data Overview */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <h2 className="text-xl font-bold text-brand-text">
            What&apos;s in the Demo
          </h2>
          <p className="mt-2 mb-6 text-sm text-brand-text-muted">
            The demo environment simulates an SAP ECC → S/4HANA migration with
            realistic data across the full workflow.
          </p>
          <div className="grid gap-6 md:grid-cols-4">
            {[
              { stat: "1,000", label: "Source Users", sub: "Across 11 departments" },
              { stat: "20", label: "AI Personas", sub: "Clustered by permission patterns" },
              { stat: "37", label: "Target Roles", sub: "SAP S/4HANA security roles" },
              { stat: "2,130", label: "Assignments", sub: "User-to-role mappings" },
            ].map((d) => (
              <div key={d.label} className="text-center">
                <p className="text-3xl font-bold text-teal-700">{d.stat}</p>
                <p className="mt-1 text-sm font-semibold text-brand-text">
                  {d.label}
                </p>
                <p className="text-xs text-brand-text-muted">{d.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-brand-accent-dark px-6 py-16 text-center">
        <h2 className="text-2xl font-bold text-white">Ready to explore?</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-slate-400">
          Click any persona on the sign-in page and credentials are filled in
          automatically. Switch between demo environments to explore different
          migration scenarios.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/login"
            className="flex items-center gap-2 rounded-lg bg-teal-600 px-8 py-3 text-sm font-semibold text-white hover:bg-teal-700 transition-colors"
          >
            Sign In to Demo
            <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href="https://provisum.io/platform"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-slate-600 px-6 py-3 text-sm font-medium text-slate-300 hover:bg-slate-800 transition-colors"
          >
            Learn More at provisum.io
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-brand-accent-dark border-t border-slate-700 px-6 py-8 text-center">
        <p className="text-xs text-slate-500">
          &copy; {new Date().getFullYear()} Provisum Corp. All rights reserved.
        </p>
        <p className="mt-1 text-xs text-slate-600">
          This is a demonstration environment with simulated data.
        </p>
      </footer>
    </div>
    </DemoGate>
  );
}
