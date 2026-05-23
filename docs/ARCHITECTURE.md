# Provisum Architecture

This document describes the system design, technical decisions, and component architecture for Provisum (formerly AIRM).

---

## System Overview

Provisum is a Next.js 14 web application that automates enterprise role migration workflows. The system ingests source user data and role hierarchies, uses Claude AI to cluster users into security personas, maps those personas to target roles, performs SOD conflict analysis, and routes the results through a structured approval workflow. It also includes an AI chatbot (Lumen), 3-phase SOD triage, risk quantification, feature flags, webhooks, scheduled exports, multi-tenant organization support, migration health dashboard, incident detection with AI triage, SOX evidence packages, and AI-assisted mapping suggestions. **Current version: v1.5.0** (60 tables — 57 live + 3 append-only history, 51+ pages, 92+ API routes).

```
┌─────────────┐      ┌──────────────┐      ┌──────────┐      ┌────────────┐      ┌──────────┐
│   Upload    │─────>│   Personas   │─────>│ Mapping  │─────>│ SOD Check  │─────>│Approvals │
│ (CSV/Excel) │      │ (AI cluster) │      │ (AI+manual)│    │ (rules)    │      │ (queue)  │
└─────────────┘      └──────────────┘      └──────────┘      └────────────┘      └──────────┘
     Stage 1             Stage 2               Stage 3            Stage 4            Stage 5
```

---

## Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Framework** | Next.js 14 (App Router) | Server components for simple architecture; SSR for auth; App Router for flexible routing |
| **Database** | Supabase Postgres + Drizzle ORM (`postgres-js` driver) | Managed cloud Postgres with connection pooling; Drizzle for type-safe async queries; `prepare: false` for Supabase transaction pooler compatibility |
| **AI** | `@anthropic-ai/sdk` (Claude) | Persona generation, role mapping, SOD analysis, and Lumen chatbot; cost-effective batch clustering; no training required |
| **Auth** | Supabase Auth + `@supabase/ssr` | JWT-based sessions via httpOnly cookies; managed auth infrastructure; password policy + account lockout |
| **UI** | shadcn/ui + Tailwind CSS | Pre-built, accessible components; rapid UI iteration; theming support |
| **Tables** | TanStack React Table | Headless, flexible table library; supports sorting, filtering, pagination out-of-the-box |
| **Monitoring** | Sentry (`@sentry/nextjs`) + `lib/monitoring.ts` | Error tracking, performance monitoring, structured logging |
| **Email** | Resend | Transactional email for user invites and lead notifications |
| **Exports** | exceljs + pdfkit + csv-parse | Multi-format exports; Excel for bulk operations; PDF for reports; CSV for data interchange |
| **Background Jobs** | `waitUntil()` from `@vercel/functions` + `lib/job-runner.ts` | Fire-and-forget async processing with retry logic and dead-letter queue |

---

## Architecture Layers

### 1. Application Layer (Next.js Pages)

Pages are organized by feature and workflow stage:

```
app/
├── dashboard/          # KPIs, strapline, dept kanban, provisioning alerts
├── mapping/            # Role assignment workspace (Stage 3)
├── approvals/          # Approval queue (Stage 5)
├── sod/                # SOD conflict analysis (Stage 4)
├── personas/           # Persona management and AI results
├── releases/           # Release management + comparison
├── risk-analysis/      # Risk quantification dashboard
├── calibration/        # Low-confidence assignment review
├── least-access/       # Provisioning alert detail view
├── notifications/      # In-app notification inbox
├── timeline/           # Multi-release project timeline
├── admin/              # Admin console (users, settings, feature flags, webhooks,
│                       #   scheduled exports, validation)
├── login/              # Authentication
├── setup/              # First-run admin creation + invite accept
├── methodology/        # Public methodology page
├── overview/           # Public overview page
├── quick-reference/    # Public quick-reference guide
└── api/                # 70+ API routes for mutations and integrations
```

**Key Pattern**: Pages are async server components. They call database queries directly (no API round-trip for reads). Mutations go through `/api/**` routes. All DB access is async.

```typescript
// Server component: direct async DB access
export const dynamic = "force-dynamic";
export default async function DashboardPage() {
  const user = await requireAuth();
  const stats = await getDashboardStats();  // async
  return <Dashboard stats={stats} />;
}

// Client component: uses fetch for mutations
"use client";
export function ApproveButton({ assignmentId }: { assignmentId: number }) {
  const router = useRouter();
  const handleApprove = async () => {
    await fetch("/api/approvals/approve", {
      method: "POST",
      body: JSON.stringify({ assignmentId }),
    });
    router.refresh(); // Re-fetch server data
  };
}
```

### 2. API Layer (`/app/api`)

RESTful endpoints for mutations (writes). All endpoints validate the Supabase JWT session, check role-based access, and return JSON. There are 92+ route handlers organized across 28 directories. See `docs/API_REFERENCE.md` for the full reference.

See `docs/API_REFERENCE.md` for the complete endpoint reference grouped by domain.

### 3. Business Logic Layer (`/lib`)

Core functions and utilities:

| Module | Responsibility |
|--------|-----------------|
| `auth.ts` | Supabase JWT session management, role hierarchy, permission checks |
| `scope.ts` | Org-unit-based user filtering and department resolution |
| `queries/` | 11 domain query modules (see below) |
| `settings.ts` | Key-value project configuration (persistent in DB, async) |
| `strapline.ts` | Rule-based dashboard status messages (no AI calls) |
| `monitoring.ts` | Structured logging, Sentry integration, error context |
| `email.ts` | Resend email client for invites and notifications |
| `password-policy.ts` | Password complexity validation (12-char min, complexity rules) |
| `job-runner.ts` | Background job execution with retry and dead-letter |
| `feature-flags.ts` | DB-backed feature flags with 60s cache, role/user/percentage targeting |
| `webhooks.ts` | HMAC-SHA256 signed webhook delivery (11 event types, auto-disable) |
| `ai/` | Claude API integration for persona generation, mapping, SOD, and Lumen |
| `utils.ts` | Utility functions (cn, formatting, etc.) |

**Query Modules** (`lib/queries/`):

All queries are async. Consumers import from `@/lib/queries` (barrel export via `index.ts`).

| Module | Key Exports |
|--------|-------------|
| `dashboard.ts` | `getDashboardStats()`, `getDepartmentMappingStatus()`, `getSourceSystemStats()` |
| `users.ts` | `getUsers(filterUserIds?)`, `getUserDetail()`, `getAllSimpleUsers()` |
| `personas.ts` | `getPersonas()`, `getPersonaDetail()`, `getPersonaIdsForUsers()` |
| `roles.ts` | `getSourceRoles()`, `getTargetRoles()`, role detail functions |
| `sod.ts` | `getSodConflicts()`, `getSodConflictsDetailed()`, `getOpenSodConflictsByPersona()` |
| `approvals.ts` | `getApprovalQueue()`, `getApprovalQueueScoped()` (DB-level filter) |
| `mapping.ts` | `getUserGapAnalysis()`, `getUserRefinementDetails()` |
| `risk.ts` | `getLeastAccessAnalysis()`, `getAggregateRiskAnalysis()` (parallelized bulk queries) |
| `common.ts` | `getUsersScoped()` (DB-level filter), release scoping, work assignment helpers |
| `jobs.ts` | `getJobs()` |
| `audit.ts` | `getAuditLog()` |

**Key Pattern**: All database queries are async. Use `await` for every DB call. Use `const [row] = await db.select()...` for single rows and `const rows = await db.select()...` for multiple.

```typescript
// In lib/queries/dashboard.ts
export async function getDashboardStats(userId?: number) {
  const user = userId ? await getAppUser(userId) : await requireAuth();
  const scopedUserIds = await getUserScope(user);

  const [{ count: uploadedCount }] = await db.select({ count: sql`count(*)` })
    .from(schema.users)
    .where(scopedUserIds ? inArray(schema.users.id, scopedUserIds) : undefined);
  // ... more aggregations
}
```

### 4. Data Access Layer (Drizzle + Supabase Postgres)

**Schema** (`db/schema.ts`): Single source of truth for all 60 tables (57 live + 3 append-only history). Drizzle ORM maps TypeScript types to SQL using `pgTable` from `drizzle-orm/pg-core`.

```typescript
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull(),
  email: text("email"),
  organizationId: integer("organization_id").references(() => organizations.id),
  // ...
});

export const personas = pgTable("personas", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id"),
  name: text("name").notNull(),
  description: text("description"),
  organizationId: integer("organization_id").references(() => organizations.id),
  // ...
});
```

**Query Pattern**: Always use destructured array for single rows. No `.get()` or `.all()` (those were SQLite-specific).

```typescript
// Single row
const [user] = await db.select().from(schema.appUsers).where(eq(schema.appUsers.id, 1));

// Multiple rows
const users = await db.select().from(schema.users).where(inArray(schema.users.id, [1, 2, 3]));
```

**Connection**:
- Lazy proxy pattern: DB connection is initialized on first use (safe during build without `DATABASE_URL`)
- Driver: `postgres-js` with `prepare: false` (required for Supabase transaction pooler on port 6543)
- Connection string: `DATABASE_URL` env var pointing to Supabase pooled endpoint
- 56 database indexes across all tables for hot query paths

**Tables** (55 total):

| Category | Tables |
|----------|--------|
| **Core data** | `users`, `sourceRoles`, `targetRoles`, `sodRules`, `orgUnits` |
| **Personas** | `personas`, `userPersonaAssignments`, `personaSourcePermissions`, `personaConfirmations`, `consolidatedGroups` |
| **Mapping** | `personaTargetRoleMappings`, `userTargetRoleAssignments`, `userSourceRoleAssignments`, `workAssignments` |
| **Permissions** | `sourcePermissions`, `targetPermissions`, `sourceRolePermissions`, `targetRolePermissions`, `permissionGaps`, `targetSecurityRoleTasks`, `targetTaskRoles`, `targetTaskRolePermissions` |
| **SOD** | `sodConflicts`, `leastAccessExceptions`, `securityDesignChanges`, `securityWorkItems` |
| **Releases** | `releases`, `releaseUsers`, `releaseOrgUnits`, `releaseSourceRoles`, `releaseTargetRoles`, `releaseSodRules` |
| **Auth & users** | `appUsers`, `appUserSessions`, `appUserReleases`, `userInvites`, `ssoConfigurations` |
| **Platform** | `organizations`, `featureFlags`, `webhookEndpoints`, `webhookDeliveries`, `scheduledExports`, `notifications`, `chatConversations`, `rateLimitEntries`, `reviewLinks`, `workstreamItems` |
| **System** | `systemSettings`, `auditLog`, `processingJobs`, `incidents`, `evidencePackageRuns`, `demoLeads`, `mappingFeedback` |

---

## Data Flow: Role Mapping Workflow

### Stage 1: Upload
User uploads CSV/Excel files containing:
- `users` -- source user records (ID, name, department, job title, org unit, source roles)
- `sourceRoles` -- legacy role catalog
- `targetRoles` -- target role catalog
- `sodRules` -- SOD conflict rulebook

**Action**: Parsed and inserted into database. No transformation yet.

### Stage 2: Personas (AI-Powered)
Claude API clusters users into security personas based on shared permission patterns.

**Flow**:
1. Extract all user source role assignments from database
2. AI analyzes a 100-user sample to design personas (prevents JSON truncation)
3. Programmatic permission-overlap matching assigns all remaining users
4. Store personas and `userPersonaAssignments` (with confidence score) in database
5. Compute `personaSourcePermissions` (weighted characteristics)

**Background Processing**: Persona generation runs as a background job via `waitUntil()` from `@vercel/functions`. The client polls `/api/jobs/[id]` for status updates. Jobs have retry logic and dead-letter queuing via `lib/job-runner.ts`.

### Stage 3: Mapping
Mappers assign each persona to one or more target roles (AI-assisted or manual).

**Action**: User selects persona, selects target role(s), system computes coverage and excess provisioning.

**Computation**:
- `coveragePercent` = (users mapped / total users in persona) x 100
- `excessPercent` = (target role size / persona size) x 100 (indicates over-provisioning)

**Storage**: `personaTargetRoleMappings` (persona ID + target role + coverage/excess %)

### Stage 4: SOD Analysis
System detects conflicts between assigned roles against the SOD rulebook.

**Flow**:
1. Fetch SOD rules from `sodRules` table
2. For each user assignment, check if assigned roles conflict
3. Store violations in `sodConflicts` (severity: critical / high / medium / low)
4. Display conflicts by user (grouped by severity)

**Conflict Resolution**:
- Conflicts block approval until user is reassigned or exception is accepted
- Approver can review conflict and accept (with optional justification)

### Stage 5: Approval
Approvers review assignments and approve/reject.

**Action**: Approver reviews user + assigned roles + SOD conflicts, then clicks Approve or Reject.

**Assignment Workflow Statuses**:
```
draft -> [Submit for Review] -> pending_review -> [SOD Analysis] -> sod_rejected | compliance_approved -> [Approval] -> approved
```

---

## Role-Based Access Control

**Hierarchy** (higher = more permissions):

```
system_admin (100)
    |-- admin (80)
        |-- project_manager (70)
        |-- approver (60) [scoped]
        |-- coordinator (50) [scoped]
        |-- mapper (40) [scoped]
             |-- viewer (20)
```

**Role Definitions**:

| Role | Use Case | Scope |
|------|----------|-------|
| `system_admin` | Infrastructure / system configuration | Global |
| `admin` | Project lead / migration manager | Global |
| `project_manager` | Program oversight / timeline management | Global |
| `approver` | SAP architect or compliance | Org-unit subtree |
| `coordinator` | Migration coordinator | Org-unit subtree |
| `mapper` | Power user assigning roles | Org-unit subtree |
| `viewer` | Read-only (stakeholder review) | Global |

**Scoping**: Mapper, approver, and coordinator see only users in their assigned org unit subtree.

```typescript
// lib/scope.ts
export async function getUserScope(appUser: AppUser): Promise<number[] | null> {
  // admin, system_admin, project_manager, and viewer have no scope restriction
  if (["admin", "system_admin", "project_manager", "viewer"].includes(appUser.role)) {
    return null; // null means "no filter -- return all users"
  }

  // mapper, approver, coordinator: resolve org unit subtree
  const ouIds = await getDescendantOrgUnitIds(appUser.assignedOrgUnitId);
  return await getUsersInOrgUnitSubtree(ouIds);
}
```

---

## Authentication & Sessions

**Stack**: Supabase Auth with JWT sessions managed by `@supabase/ssr`.

**Flow**:
1. User submits username + password to `/api/auth/login`
2. Supabase Auth validates credentials and issues a JWT
3. `@supabase/ssr` sets the JWT as an httpOnly cookie
4. Middleware validates the JWT on every request via `getSessionUser()`
5. `getSessionUser()` reads the Supabase JWT, then looks up the `appUsers` row via `supabaseAuthId`

**Session**:
- JWT stored as httpOnly cookie (managed by `@supabase/ssr`)
- Secure flag in production (HTTPS only)
- SameSite: lax

**Password Policy** (`lib/password-policy.ts`):
- 12-character minimum
- Requires uppercase + lowercase + digit + special character

**Account Lockout**:
- 5 failed login attempts per username triggers 5-minute lockout
- Tracked in-memory per-account (not global IP-based)

**First Run**:
- No users exist yet
- User is redirected to `/setup` to create initial admin
- After setup, `/setup` is locked (first admin already exists)

**Invite Flow**:
- Admin sends invite (single or bulk CSV) via `/api/admin/invite`
- Invite email sent via Resend with accept link
- Recipient creates account at `/setup` (invite accept mode)
- Resend available for pending invites

---

## Multi-Tenant Organization Support

**Status**: Phase 3 complete — `organization_id NOT NULL` enforced on all entity tables.

Every top-level entity table has a required `organization_id` FK referencing the `organizations` table. Junction tables and assignment tables inherit tenant scope through their parent FKs.

- In standalone Provisum, a default organization is auto-created on first run
- All queries are organization-scoped via Drizzle `where` clauses
- RLS policies on Supabase enforce tenant isolation at the database level as a second layer
- Designed for SaaS mode where multiple organizations share a single Vercel deployment

---

## Feature Flags

DB-backed feature flag system with 60-second in-memory cache.

**Targeting**:
- Global on/off toggle
- Role-based targeting (enable for specific roles)
- User-based targeting (enable for specific users)
- Percentage rollout (gradual feature release)

**Management**: Admin console at `/admin` (feature flags tab). API at `/api/admin/feature-flags`.

---

## Webhook Event System

HMAC-SHA256 signed webhook delivery for external integrations.

**Event Types** (11): Assignment created, approved, rejected, SOD conflict detected, persona generated, release created, and more.

**Reliability**:
- Automatic retry on delivery failure
- Auto-disable endpoint after consecutive failures
- Delivery log in `webhookDeliveries` table
- Management UI in admin console

---

## Lumen AI Chatbot

Context-aware AI assistant powered by Claude, available throughout the application.

**Phases**:
1. **Read-only** (current) -- answers questions about the migration project using context from the database
2. **Tool calling** (planned) -- auto-map roles, run SOD analysis, execute data queries
3. **RAG** (planned) -- retrieval-augmented generation over uploaded documents
4. **Chat history** (planned) -- persistent conversation history per user

**Implementation**: `POST /api/assistant` with `maxDuration = 300` for Vercel. Conversations stored in `chatConversations` table.

---

## Risk Quantification Dashboard

Available at `/risk-analysis`. Aggregates risk metrics across the migration:

- SOD conflict severity distribution
- Over-provisioning risk scores
- Department-level risk heatmap
- Confidence distribution for AI assignments
- Trend analysis across releases

Powered by parallelized bulk queries in `lib/queries/risk.ts`.

---

## Calibration Queue

Available at `/calibration`. Surfaces low-confidence AI persona assignments for human review.

- Filters assignments below the `confidence_threshold` setting (default 65%)
- Allows reviewers to confirm, reassign, or override AI decisions
- Improves AI accuracy over time through feedback loop

---

## Release & Program Hierarchy

Provisum uses a **Program > Release** hierarchy:

- **Program**: The migration initiative (e.g., "SAP S/4HANA Migration - North America")
- **Release**: A go-live wave within the program

Every release must have a `program_id` FK. Releases scope which users, org units, source roles, target roles, and SOD rules are included via junction tables (`releaseUsers`, `releaseOrgUnits`, etc.).

**Release statuses**: `planning`, `in_progress`, `approved`, `deployed`, `stabilizing`, `completed`, `archived`, `cancelled`

**Coordinator due dates**: Each release has mapping, review, and approval deadlines.

---

## Notifications

Notifications are stored in the `notifications` table. Recipients see an unread badge in the sidebar and can view messages in the `/notifications` inbox.

**In-app**: Coordinators, admins, and system_admins can compose and send to mappers/approvers.

**Email**: Resend integration (`lib/email.ts`) sends transactional emails for user invites and (when configured) notification digests. Requires `RESEND_API_KEY` env var.

---

## Provisioning Alerts

Surfaces mappings where a persona is mapped to a role significantly larger than needed.

**Computation**:
```
excessPercent = (target role users / persona users) x 100

if excessPercent > threshold (default 30%):
  -> Flag as "Provisioning Alert"
```

**UI**:
- **Dashboard**: Scoped alerts for user's org unit (inline accept/revoke)
- **Detail page**: `/least-access` shows full analysis across all org units

**Exception Handling**:
- Approver/admin can accept exception with justification (stored in `leastAccessExceptions`)
- Exception recorded in audit log
- Alert no longer blocks approval

---

## Dashboard & Strapline

**Dashboard** (`app/dashboard/page.tsx`):
- **KPI Cards**: Workflow stage progress (upload, personas, mapping, SOD, approvals)
- **Strapline**: Opinionated, role-aware status message (see below)
- **Department Kanban**: Per-department breakdown across all stages
- **Provisioning Alerts**: Scoped to user's org unit with inline accept/revoke

**Strapline** (`lib/strapline.ts`):

Rule-based status generator (no AI) that identifies the critical path and tells users what to do:

```typescript
// Examples:
"15 assignments are stuck waiting for approvals -- this is the critical path right now."
"Good news: all users are mapped. 3 conflicts need review before going live."
"2 mappers are behind. Consider reassigning work to stay on schedule."
```

**Rules** (simplified):
1. Find the stage with the highest incomplete percentage
2. If >50% of that stage is pending, it's the bottleneck
3. Compose a message that names the bottleneck and suggests action
4. Color code: green (on track), yellow (warning), red (critical)

---

## Settings & Configuration

Project-wide settings are stored in `systemSettings` table (key-value pairs), accessed via async functions.

**Accessible via Admin Console**:

| Key | Description | Default |
|-----|-------------|---------|
| `project_name` | Display name in header/sidebar | `Provisum` |
| `least_access_threshold` | Over-provisioning alert threshold (%) | `30` |
| `confidence_threshold` | Min Claude confidence for auto-assignment | `65` |
| `sod_auto_reject_threshold` | SOD severity that auto-rejects | -- |

**Usage**:
```typescript
import { getSetting, setSetting } from "@/lib/settings";

const threshold = parseInt(await getSetting("least_access_threshold") ?? "30", 10);
await setSetting("project_name", "SAP ECC -> S/4HANA Migration");
```

---

## Scheduled Exports

Configured via admin console and executed by Vercel cron jobs.

- Export formats: Excel, CSV, PDF
- Cron trigger: `GET /api/cron/exports` (secured via `CRON_SECRET` env var)
- Configuration stored in `scheduledExports` table
- Supports filtering by release, department, and export type

---

## Module Launcher

The application entry point at `/home` renders a tile-based module launcher with 9 shortcuts. Each module tile loads a dedicated sidebar on navigation. This replaces the previous single-sidebar layout and allows mappers, approvers, and coordinators to enter their role-specific workflow without passing through unrelated screens.

---

## Source System Typing

Source and target roles can be tagged with a system type (10 source types including SAP ECC, Oracle EBS, Workday, Salesforce, ServiceNow; 7 target types). System type is injected into Claude API prompts so persona generation and role mapping suggestions are context-aware for the specific platform being migrated.

---

## Knowledge Base

In-app help at `/help` serves 10 role-aware articles with full-text search and category filter. Articles are statically rendered and do not require a CMS. The system automatically filters visible articles by the current user's role.

---

## SOD Triage Workflow

SOD conflict resolution follows a 3-phase workflow:

1. **Phase 1 — Within-Role Intelligence**: Auto-detect conflicts that can be resolved by splitting within the same role family. Surfaced as suggestions before manual review begins.
2. **Phase 2 — Remapping Workspace**: Analyst re-maps individual users to alternative target roles to eliminate conflicts. Real-time conflict recalculation.
3. **Phase 3 — Compliance & Security Workspaces**: Remaining conflicts routed to compliance (risk acceptance with justification) or security (escalation to security design review). Accepted risks stored with mitigating controls documentation.

Triage state is tracked per `sodConflicts` row (`status`: open → remapping → accepted / escalated / resolved).

---

## SSO / SAML

SSO configurations are stored in `ssoConfigurations` (provider, metadata URL, entity ID, enabled flag). The admin console exposes an SSO tab at `/admin/sso` for setup. Login page checks for active SSO configs and renders a provider-specific button. Domain-based SSO lookup via `GET /api/admin/sso` allows redirect without manual provider selection. Underlying implementation uses Supabase's built-in SAML 2.0 support.

---

## SOX Evidence Package

Available at `/admin/evidence-package` (admin and above). Generates a structured Excel workbook containing: user-persona assignment audit trail, SOD conflict log with resolution status, approval workflow timestamps, and change log. Used to support SOX control testing and external audits.

---

## Key Design Decisions

### 1. Supabase Postgres + Drizzle ORM (not SQLite)
**Decision**: Use managed cloud Postgres via Supabase with Drizzle ORM for type-safe async queries.

**Trade-off**: Requires external database service; slightly more complex connection setup (pooler config, `prepare: false`).

**Rationale**: Production-ready from day one; supports concurrent users and Vercel serverless functions; Supabase provides managed auth, RLS, and connection pooling; data persists independently of deployment.

### 2. Server Components (not API-first SPA)
**Decision**: Use Next.js server components for data fetching; pages call DB directly.

**Trade-off**: Less fine-grained API contract; tighter coupling between pages and DB.

**Rationale**: Simpler architecture; faster initial build; no N+1 overhead from separate API calls.

### 3. Claude API for Personas (not Local ML)
**Decision**: Use Claude API for persona generation, mapping suggestions, SOD analysis, and conversational AI (Lumen).

**Trade-off**: Requires API calls; cost per run (though modest).

**Rationale**: No infrastructure for ML ops; Claude's accuracy is high; cost is acceptable for batch clustering. Two-phase approach (AI sample analysis + programmatic bulk assignment) prevents JSON truncation.

### 4. Supabase Auth with JWT Sessions (not custom cookie auth)
**Decision**: Use Supabase Auth for identity management with JWT sessions managed by `@supabase/ssr`.

**Trade-off**: Dependency on Supabase auth service; JWT tokens are larger than simple session IDs.

**Rationale**: Managed auth infrastructure; built-in password hashing and session management; compatible with Supabase RLS policies; extensible to OAuth/SSO in the future. Custom password policy and account lockout layered on top.

### 5. Role Hierarchy (not Fine-Grained Permissions)
**Decision**: 7-level role hierarchy; data scoping by org unit.

**Trade-off**: Coarser than full RBAC; per-feature access managed via role checks rather than permission grants.

**Rationale**: Enterprise roles map naturally; org-unit scoping covers most delegation patterns. Feature flags provide additional toggle control where needed.

### 6. Multi-Tenancy (Phase 1)
**Decision**: Organization-scoped data with nullable `organization_id` FKs for backward compatibility.

**Trade-off**: Nullable FK means existing data works without migration; must be enforced at query level until RLS covers all paths.

**Rationale**: Prepares for SaaS mode and Cursus integration without breaking existing single-tenant deployments. RLS policies on Supabase enforce tenant isolation at the database level.

### 7. Background Jobs via `waitUntil()` (not external queue)
**Decision**: Use Vercel's `waitUntil()` for fire-and-forget background processing with `lib/job-runner.ts` for retry logic.

**Trade-off**: No persistent queue; jobs lost if function crashes mid-execution.

**Rationale**: No infrastructure overhead; sufficient for current workloads (AI pipeline runs, webhook delivery). Dead-letter tracking provides observability. Can migrate to a proper queue (e.g., Vercel Queues) when needed.

---

## Deployment & Operations

**Hosting**: Vercel (auto-deploy from `main` branch via GitHub integration)

**Database**: Supabase Postgres (project `anjxhleuutdcwipassij`, pooled connection on port 6543)

**Custom Domains**:
- `demo.provisum.io` -- demo instance
- `app.provisum.io` -- production app (same Vercel project)
- `provisum.io` -- sales/marketing site (separate Vercel project)

**Required Environment Variables**:

| Variable | Purpose | Required |
|----------|---------|----------|
| `DATABASE_URL` | Supabase pooled connection string (port 6543) | Yes |
| `ANTHROPIC_API_KEY` | Claude API key for AI pipeline and Lumen | Yes |
| `ENCRYPTION_KEY` | AES-256-GCM key for encrypting sensitive settings | Yes |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key (for client-side auth) | Yes |
| `CRON_SECRET` | Vercel cron job auth token | For cron jobs |
| `RESEND_API_KEY` | Resend API key for transactional email | For invites/email |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN for error tracking | For monitoring |
| `SENTRY_AUTH_TOKEN` | Sentry auth token for source map uploads | For monitoring |
| `NEXT_PUBLIC_APP_URL` | Public application URL | For email links |

**Serverless Function Limits**:
- Standard pages: `maxDuration = 60` (dashboard, risk-analysis, mapping, validation, release comparison)
- AI pipeline routes: `maxDuration = 300`
- Cron jobs: standard function duration limits

**Operations**:
- Health check: `GET /api/health` returns `{"status":"ok","components":{"database":"connected"}}`
- Schema changes: `pnpm db:push` (no migration files for dev)
- Seed data: `pnpm db:seed` or `pnpm db:seed --demo=<pack>`
- Logs: `vercel logs --follow` for real-time monitoring
- Errors: Sentry dashboard (when DSN configured)

See `DEPLOYMENT.md` for detailed setup and operations procedures.

---

## Cursus Alignment

Provisum is designed to operate standalone or as an embedded module within Cursus (an organizational intelligence platform). The architectural alignment spec lives in `docs/Provisum_Cursus_Architectural_Alignment.md`.

Key points:
- Shared tables (organizations, personas, programs, releases, audit_log) use no prefix
- Provisum-only tables use `rm_` prefix when embedded in Cursus
- Persona sync is one-directional: Provisum to Cursus via `GET /api/integration/personas`
- Integration endpoints at `/api/integration/` require API key auth

---

## Future Architecture Considerations

1. **Lumen Phase 2-4**: Tool calling, RAG over documents, persistent chat history
2. **Bulk Mapping Actions**: Multi-select personas and assign same target role
3. **Vercel Queues**: Replace `waitUntil()` with persistent queue for long-running jobs
4. **OAuth/SSO**: Leverage Supabase Auth's built-in OAuth providers
5. **Analytics**: Track usage patterns and persona quality metrics
6. **UUID Migration**: Convert remaining `serial` PKs to `uuid` for Cursus compatibility
