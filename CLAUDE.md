# CLAUDE.md — Provisum Developer Context

This file gives Claude Code the context needed to work effectively in this codebase. Read before making changes.

> **Documentation index:** For a full map of all project docs (specs, PRDs, testing, deployment, archive), see `DOC_INDEX.md` in the project root (`AI Role Mapping Tool/DOC_INDEX.md`).

## Planning & Work Tracking

**Source of truth:** the management suite (https://dashboard-pied-kappa-81.vercel.app) — this project has its own section on Backlog / Board / Sprints / Roadmap / Projects. **Do not create local planning docs** (ROADMAP.md, TODO.md, HANDOFF.md); archived copies live in `docs/archive/`.

**At session start:** call `get_session_playbook()` first — it returns the canonical workflow rules (vocabulary, rituals, "update MS" sync) from the management suite. That playbook is authoritative; this file is just a pointer.

**Then orient:**
`get_project_info()` → `list_my_work()` → `list_sprints({status:"active"})`.

**At session end:** if jacob says "update MS" (or use the `/update-ms` slash command), run the sync pass from section E of the playbook.

**`pm` MCP** is registered in `.mcp.json` (one level above `airm/`, at `AI Role Mapping Tool/.mcp.json`) with a project-scoped bearer token. Approved via `enabledMcpjsonServers` in `.claude/settings.local.json`. The token is secret; `.mcp.json` is not tracked by git.

**Never fabricate.** Every work item must trace to a commit, conversation, or codebase signal.

---

## What this project is

Provisum (formerly AIRM) is a **Next.js 14** web tool for enterprise role migration projects (e.g. SAP ECC → S/4HANA). It manages the full workflow: upload source data → AI persona generation → role mapping → SOD conflict analysis → approvals. It uses Supabase Auth with JWT sessions, 7 roles (including `project_manager`), and org-unit-based scoping. Multi-tenant org isolation is Phase 3 complete (`organization_id` NOT NULL on all entity tables). The `airm/` directory name is retained locally — display strings use "Provisum" everywhere. Schema has **57 tables** in Supabase Postgres. **Current version: v1.5.0** — deployed at https://demo.provisum.io (demo) and https://app.provisum.io (prod). Vercel projects: `provisum-demo`, `provisum-sandbox`, `provisum-prod` on team `team_fEadrGrB1ys7beUytc8Eh5bw`. The old `airm` Vercel project has been deleted.

---

## Critical: Framework version

This project is **Next.js 14** — NOT Next.js 15 or 16.

- `cookies()`, `headers()`, `params`, `searchParams` are all **synchronous** here. Do not make them async.
- Middleware is `middleware.ts` (not `proxy.ts`).
- The hook system will sometimes warn about async APIs — **ignore those warnings**. They are false positives from tools that assume Next.js 16.
- `export const dynamic = "force-dynamic"` is used on pages that must not be statically cached.

---

## Database

**Supabase Postgres via Drizzle ORM + `postgres-js`.** All queries are **async**.

```ts
// Pattern: always destructure [0] for single row, await for multiple
const [row] = await db.select({...}).from(schema.table).where(...);
const rows = await db.select({...}).from(schema.table).where(...);
```

- Schema lives in `db/schema.ts` (uses `pgTable`, `serial`, `boolean` from `drizzle-orm/pg-core`).
- Connection via `DATABASE_URL` env var (Supabase pooled connection string, port 6543).
- After any schema change: `pnpm db:push` (no migration files needed for dev).
- DB connection is lazily initialized — safe during build even without `DATABASE_URL`.
- Seed: `pnpm db:seed` or `pnpm db:seed --demo=<pack>`. Data persists across deploys.
- For API-based demo reset: `seedDatabase(db, packName)` exported from `db/seed.ts`.

---

## Authentication

`lib/auth.ts` — Supabase Auth JWT sessions via `@supabase/ssr`.

```ts
const user = await requireAuth();          // throws redirect to /login if not authed
const user = await getSessionUser();       // returns null if not authed
await requireRole(["admin", "mapper"]);    // throws redirect to /unauthorized if wrong role
```

**Role hierarchy** (higher = more access):
```
system_admin: 100 → admin: 80 → security_architect: 75 → project_manager: 70 → approver: 60 → compliance_officer: 55 → coordinator: 50 → mapper: 40 → viewer: 20
```

Session cookie: Supabase JWT (httpOnly, managed by `@supabase/ssr`). Middleware uses a **default-secure** model — all routes require authentication unless explicitly listed as public. Public paths are split into exact matches (`PUBLIC_EXACT` Set) and prefix matches (`PUBLIC_PREFIXES` array) to prevent accidental exposure. Public pages: `/`, `/login`, `/setup`, `/methodology`, `/overview`, `/quick-reference`. Public prefixes: `/api/auth/`, `/api/health`, `/review/`, `/api/cron/`, `/api/admin/users/invite/accept`.

**Password policy:** 12-char minimum, uppercase + lowercase + digit + special character. Validated in `lib/password-policy.ts`. Enforced on user creation and password change.

**Account lockout:** 5 failed attempts per username triggers 5-minute lockout. Tracked in-memory per-account (not global IP-based).

**Action permissions by role:**
| Action | system_admin | admin | mapper | approver | coordinator | viewer |
|--------|:---:|:---:|:---:|:---:|:---:|:---:|
| Generate Personas | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Auto-Map Roles | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Run SOD Analysis | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Pipeline Jobs (run) | ✅ | ✅ | ✅ | badge | badge | badge |
| Edit Role Assignments | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Submit for Review | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Approve/Reject | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Send Back to Draft | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Bulk Delete | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| See Within-Role SOD | ✅ | ✅ | security.lead | ✅ | ❌ | ❌ |

**Assignment workflow statuses:**
```
draft → [Submit for Review] → pending_review → [SOD Analysis] → sod_rejected | compliance_approved → [Approval] → approved
```
- `draft` — editable by mapper, not yet submitted
- `pending_review` — locked, awaiting SOD analysis
- `sod_rejected` — SOD conflicts found, needs resolution
- `compliance_approved` — SOD clean, ready for approver
- `ready_for_approval` — auto-promoted high-confidence assignments
- `approved` — final, provisioned

---

## Org-unit scoping

`lib/scope.ts` — determines what data a user can see.

```ts
const userIds = await getUserScope(appUser);          // null = no restriction (admin)
const depts   = await getUserScopeDepartments(appUser); // array of department names
```

- `null` means "see everything" (admin/system_admin).
- Mapper, approver, and coordinator are scoped to their `assignedOrgUnitId` and all descendant org units.
- Coordinator has no legacy `workAssignments` fallback — if `assignedOrgUnitId` is null, returns `[]`.
- Always filter queries with `inArray(schema.users.id, scopedUserIds)` when `scopedUserIds !== null`.

---

## Settings

`lib/settings.ts` — key-value project config stored in `systemSettings` table.

```ts
import { getSetting, setSetting, getAllSettings } from "@/lib/settings";

const threshold = parseInt(await getSetting("least_access_threshold") ?? "30", 10);
await setSetting("least_access_threshold", "50");
```

Do NOT add a duplicate `getSystemSetting` in `queries.ts` — use `getSetting` from `lib/settings.ts`.

---

## Key patterns

### Server components (pages)
Pages are async server components. They call DB queries directly — no API round-trip needed for reads. Mutations go through API routes.

```ts
// app/some-page/page.tsx
export const dynamic = "force-dynamic"; // prevent static caching
export default async function SomePage() {
  const user = await requireAuth();
  const data = await getMyQuery();       // async DB call
  return <ClientComponent data={data} />;
}
```

### Client components
Add `"use client"` at top. Use `useRouter().refresh()` after mutations to re-fetch server data without a full page reload.

### API routes (mutations)
All write operations go through `/app/api/**`. Pattern:
```ts
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  // validate, write to DB, return result
}
```

---

## Queries (`lib/queries/`)

Split into domain modules with a barrel re-export from `lib/queries/index.ts`. All consumers import from `@/lib/queries`.

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
| `migration-health.ts` | `getMigrationHealthData()` (10 parallel queries for migration health dashboard) |

When adding new queries, add them to the appropriate domain module (not inline in page files).

---

## Strapline (`lib/strapline.ts`)

Rule-based, opinionated status generator — no AI API call. Called in `app/dashboard/page.tsx`.

- `projectStrapline()` — project-level status for all roles
- `areaStrapline()` — scoped status for mapper/approver/coordinator
- Returns `{ project, area, tone }` where tone drives the banner colour and icon
- Language is **direct and prescriptive**: names the bottleneck, tells users what to do

---

## Provisioning Alerts (formerly "Least Access")

- **Dashboard**: `DashboardFiltered` receives `overprovisioningAlerts` computed in `app/dashboard/page.tsx`, scoped to the user's org unit. Shows inline accept/revoke workflow.
- **Full detail page**: `/least-access` still exists as a route but is not in the sidebar nav.
- **Exceptions API**: `POST/DELETE /api/least-access/exceptions`
- **Threshold setting**: `least_access_threshold` (default 30%) in admin console.
- The concept is called "Provisioning Alerts" in all UI text — avoid "least access" in new user-facing strings.

---

## Notifications

Notifications are stored in the `notifications` table and optionally sent via email (Resend).

- Coordinators, admins, and system_admins can compose and send to mappers/approvers.
- Recipients see notifications in their inbox at `/notifications`.
- Unread count shown as a badge in the sidebar (computed client-side from inbox length).
- `POST /api/notifications` — send (accepts array of `toUserIds`)
- `PATCH /api/notifications` — mark as read
- Email delivery via `lib/email.ts` (Resend) — fires alongside DB insert, fire-and-forget. Requires `RESEND_API_KEY` env var.

---

## Lumen AI Chatbot

Floating teal widget on every page. Uses `@anthropic-ai/sdk` (Claude) — NOT Vercel AI SDK.

- **Phase 1**: Read-only streaming chat, role-aware system prompt, page context
- **Phase 2**: Tool calling (13 tools) — 8 read + 5 write. Up to 3 tool calls per message. Org-unit scoped.
  - Read: `get_dashboard_stats`, `get_persona_details`, `get_sod_conflicts`, `get_mapping_status`, `get_job_status`, `get_calibration_summary`
  - Write: `trigger_auto_map`, `trigger_sod_analysis`, `create_role_mapping`, `resolve_sod_conflict`, `accept_calibration_items`, `submit_for_review`, `send_reminder`
- **Phase 3**: RAG — `lib/assistant/rag-context.ts` with 10 domain knowledge chunks, keyword+page relevance scoring
- **Phase 4**: Chat history — `chat_conversations` table, conversation sidebar, auto-save after each response
- **Phase 5**: Write-action tools — create mappings, resolve SOD, accept calibration, submit for review, send reminders via chat

Key files: `lib/assistant/tools.ts`, `lib/assistant/rag-context.ts`, `app/api/assistant/chat/route.ts`, `app/api/assistant/conversations/`, `components/chat/chat-widget.tsx`

---

## Feature Flags

`lib/feature-flags.ts` — DB-backed with 60s in-memory cache.

- `isFeatureEnabled(key, user?)` — checks targeting (role, user ID, percentage rollout)
- CRUD via `GET/POST/DELETE /api/admin/feature-flags`
- Admin UI tab in admin console
- 5 default flags seeded

---

## Webhook Events

`lib/webhooks.ts` — HMAC-SHA256 signed payload delivery to subscribed endpoints.

- 11 event types: `persona.generated`, `mapping.created/approved/rejected`, `sod.analysis_complete/conflict_resolved`, `assignment.status_changed`, `export.completed`, `user.invited`, `job.completed/failed`
- Auto-disable after 10 consecutive failures
- Wired into 7 workflow routes (fire-and-forget)
- Admin UI tab with delivery log

---

## Multi-Tenant Org Isolation

`lib/org-context.ts` — Phase 3 complete (`organization_id` NOT NULL on all entity tables).

```ts
import { getOrgId, getOrgIdForInsert } from "@/lib/org-context";

const orgId = getOrgId(user);              // user.organizationId (NOT NULL)
// All queries accept orgId as first parameter
// For inserts: organizationId: getOrgId(user)
```

- `organizations` table with name, slug, settings
- `organization_id` is **NOT NULL** on: appUsers, users, personas, sourceRoles, consolidatedGroups, targetRoles, sodRules, releases, auditLog, orgUnits
- All 44 query functions accept `orgId` and filter with `eq(table.organizationId, orgId)`
- All insert sites include `organizationId`
- Phase 4 (future): RLS policies enforce isolation at DB level

---

## Scheduled Exports

`lib/scheduled-exports.ts` — Configurable export schedules (daily/weekly/monthly).

- Vercel cron at `/api/cron/exports` (hourly check), secured by `CRON_SECRET` env var
- Admin UI tab in admin console
- `scheduled_exports` table with schedule config, next run, last status

---

## Pipeline Validation (due diligence)

System-admin-only feature at `/admin/validation` for proving the platform works as described. Not part of the product workflow — intended for due diligence, partner demos, and accuracy audits.

**Dashboard** (`app/admin/validation/validation-dashboard.tsx`):
- **Overview tab** — Pipeline flow visualization (users → personas → roles → SOD), stat cards, persona distribution chart, confidence histogram, status breakdown, edge case panel
- **Users tab** — Full searchable/filterable user table. Click any row to open a detail modal showing the complete attribution chain: source attributes → persona (with AI reasoning + confidence) → target roles (with status) → SOD conflicts
- **Personas tab** — Per-persona cards with user counts, confidence stats, and mapped target roles

**Filters**: search by name/ID/department/persona, filter by specific persona, filter by edge case category (no persona, low confidence, high SOD, complex user, etc.)

**Excel export** (`/api/admin/validation/export`): 5-tab XLSX — Validation Summary, Full Attribution Chain (all users × 17 columns with validation flags), Persona Distribution, SOD Conflicts, Methodology.

**API** (`/api/admin/validation`): Returns the full enriched dataset including per-user chain, distribution stats, confidence buckets, edge case counts, and persona-role mappings.

**Access**: `system_admin` only. Sidebar link under SYSTEM section. Auth handled by existing `/admin` prefix in middleware.

---

## AI-Assisted Mapping v2

`lib/ai/mapping-suggestions.ts` — AI reasoning layer on top of permission-overlap auto-map.

- Claude analyzes business function, naming conventions, permission overlap, and historical patterns
- Composite confidence: AI (60%) + overlap (30%) + historical acceptance (10%)
- `mapping_feedback` table stores accept/reject decisions for the learning loop
- API: `GET /api/mapping/ai-suggestions?personaId=N`, `POST /api/mapping/ai-suggestions/feedback`
- UI: "AI Suggest" button (sparkles) in mapping workspace → modal with ranked suggestions

---

## Target System Adapter

`lib/adapters/` — Framework for pulling security design from target systems.

- `target-system-adapter.ts` — TypeScript interface (`TargetSystemAdapter`)
- `mock-sap-adapter.ts` — Mock SAP S/4HANA with 9 roles + transaction codes
- `index.ts` — Adapter registry factory (`getAdapter(type, config)`)
- Admin UI: `/admin/security-design` — connection test, pull, diff review, change history
- `securityDesignChanges` table tracks detected diffs (added/removed/modified roles)

---

## Automated Support (Incident Detection)

`lib/incidents/detection.ts` + `lib/incidents/triage.ts` — Phase 1 (detect + classify + notify).

- **Detection**: `detectIncident()` deduplicates (same source+sourceRef or same title within 5 min), inserts to `incidents` table, triggers AI triage fire-and-forget
- **AI Triage**: `triageIncident()` sends incident + 10 recent incidents to Claude for classification (category, rootCause, suggestedFix, confidence, blastRadius). Critical incidents trigger admin email.
- **Wired into**: job-runner (dead-letter), health check (degraded), webhooks (auto-disabled endpoint)
- **Admin UI**: `/admin/incidents` — incident list with severity/status badges, AI triage card, re-triage button, resolution form, create form
- **Access**: `system_admin` only

Key files: `lib/incidents/detection.ts`, `lib/incidents/triage.ts`, `app/admin/incidents/`, `app/api/admin/incidents/`

---

## Target Role Lifecycle (v1.2.0)

Target roles have a `status` field: `draft` → `active` → `archived`.

- **Draft**: Newly created or AI-generated roles. Cannot be used in mapping. Shown with amber banner.
- **Active**: Approved roles available for mapping. Only active roles appear in the mapping role selector.
- **Archived**: Soft-deleted roles. Can be restored to active.

Approval flow: `security_architect` or `admin` can approve draft → active. Approval sets `approved_by` + `approved_at`.

When a target role is updated (PUT), mappers with active assignments for that role are notified via `createWorkflowNotification()`. When a draft role is approved, mappers are notified that a new role is available.

---

## Mitigating Controls (v1.2.0)

When accepting an SOD risk, users can document compensating controls:
- `mitigating_control` — description of the control
- `control_owner` — person responsible
- `control_frequency` — review cadence (daily/weekly/monthly/quarterly/annual)

Accepted risks with documented controls show a green "Controlled" badge. The risk analysis page shows a controls coverage metric.

---

## SSO/SAML Configuration (v1.2.0)

`sso_configurations` table stores per-org SAML provider config (Azure AD, Okta, Generic SAML).

- Admin tab for CRUD operations on SSO providers
- Public endpoint `GET /api/auth/sso?email=user@company.com` for domain-based provider lookup
- Login form has "Sign in with SSO" flow
- **Note**: Actual IdP redirect requires Supabase Enterprise plan. MVP stores config and shows activation CTA.

---

## Security Design Export (v1.2.0)

`GET /api/exports/security-design` — generates 3-sheet Excel workbook (ExcelJS):
1. **Role Catalog** — all target roles with status, source, approval info, perm/user counts
2. **Permission Matrix** — roles × top 50 permissions pivot table
3. **SOD Summary** — all conflicts with type, severity, status, mitigating controls

Access: `admin`, `system_admin`, `security_architect` only. Audit logged.

---

## UI conventions

- **shadcn/ui** components live in `components/ui/`. There is **no `Checkbox` component** — use `<input type="checkbox" className="h-4 w-4 accent-primary" />`.
- Toast notifications use **Sonner** (`import { toast } from "sonner"`).
- Icons from **lucide-react** only.
- `cn()` utility from `@/lib/utils` for conditional class merging.
- Colour tokens: emerald = success/approved, red = SOD conflict, orange = over-provisioning/warning, yellow = low confidence, blue = info/existing access.

---

## Cursus Alignment (Dual-SKU Architecture)

Provisum is one of three SKUs in a shared product family with Cursus, an organizational intelligence platform. The architectural alignment spec lives in `docs/Provisum_Cursus_Architectural_Alignment.md`. **Read that document before making schema changes, adding tables, or modifying the persona model.**

### Product relationship

| SKU | Description |
|-----|-------------|
| Provisum Standalone | This codebase. Security role mapping for ERP migrations. |
| Cursus | OCM + organizational intelligence. No role mapping. |
| Cursus + Role Mapping | Full platform with Provisum embedded as a module. |

When embedded in Cursus, Provisum-specific tables use the `rm_` prefix. Shared tables (organizations, personas, programs, releases, audit_log) have no prefix and are owned by the shared schema.

### Program > Release hierarchy

Provisum uses a **Program → Release** hierarchy. A program is the migration initiative (e.g., "SAP S/4HANA Migration - North America"). Releases are go-live waves within it.

- Every release must have a `program_id` FK. There are no orphan releases.
- Programs have a nullable `portfolio_id` column. **Do not build portfolio management UI in Provisum.** This FK exists solely as an integration seam for Cursus to populate when embedding. In standalone Provisum it is always null.
- When creating a new org, auto-create a default program. Users can create additional programs later.

### Multi-tenancy

- Every top-level entity table has an `organization_id` FK (NOT NULL) referencing `organizations`.
- Junction tables and assignment tables inherit tenant scope through their parent FKs and do not need a direct `organization_id`.
- All queries must be organization-scoped. Never return data across organizations.
- RLS policies on Supabase enforce tenant isolation at the database level.

### Persona model (shared with Cursus)

Personas are the primary shared entity between Provisum and Cursus. The rules:

- Provisum is the **source of truth** for security persona attributes: `name`, `businessFunction`, `consolidatedGroupId`, `source`, `isActive`, permission weights, user assignments, confidence scores.
- Cursus is the source of truth for change management attributes: `change_history`, `technology_proficiency`, `parent_persona_id`, stakeholder group links.
- The `source` enum on personas must include: `ai`, `manual`, `hris_import`. Do not remove or rename these values.
- Provisum exports personas to Cursus via `GET /api/integration/personas`. The export payload includes `business_function` and `consolidated_group_name` to power matching on the Cursus side.
- Sync is **one-directional: Provisum → Cursus**. Provisum does not receive persona data back from Cursus.
- In embedded mode (Cursus + Role Mapping SKU), the role mapping module reads and writes the shared `personas` table directly. There is no separate `rm_personas` table. Security-specific tables (`rm_persona_source_permissions`, `rm_user_persona_assignments`) FK to `personas.id`.

### Schema rules for Cursus compatibility

1. **Use UUIDs for all primary keys.** Cursus uses `uuid` PKs everywhere. Provisum tables that still use `serial`/`integer` PKs must be migrated to `uuid` with `defaultRandom()`.

2. **Every table must have `created_at` and `updated_at` timestamps** (`timestamptz`, defaultNow).

3. **Enum values use snake_case.** Match Cursus convention: `in_progress` not `inProgress`, `ai_inferred` not `aiInferred`.

4. **Column names use snake_case in the database.** Drizzle maps these to camelCase in TypeScript. Do not rename DB columns to camelCase.

5. **Audit log entries must include `organization_id`.** Every auditable action must write to `audit_log` with the org context.

6. **Do not create tables that duplicate Cursus shared tables.** If Cursus already has a table for a concept (organizations, personas, programs, releases, notifications, audit_log), use the same structure. Check the Cursus schema at `docs/Provisum_Cursus_Architectural_Alignment.md` Section 6 for the full shared vs. prefixed table list.

7. **New Provisum-only tables should be designed as `rm_`-prefixable.** When naming a new table, verify it would make sense with an `rm_` prefix in the embedded module context. If the concept is shared (org-level, not security-specific), it should go in the shared schema, not a Provisum-only table.

### Release status enum (aligned superset)

The release status enum covers both Provisum and Cursus lifecycle states:

```
planning → in_progress → approved → deployed → stabilizing → completed → archived → cancelled
```

- `approved` is Provisum-specific (security mapping approval gate). Cursus releases skip this state.
- `deployed` and `stabilizing` are Cursus-originated states that Provisum should support for go-live tracking.
- `cancelled` replaces `archived` for releases that were abandoned (not completed).

### Integration API convention

External integration endpoints live under `/api/integration/`. These are REST (not tRPC), Zod-validated, and return JSON. They serve two consumers:

1. **Cursus** — reads Provisum personas, claims programs via `portfolio_id`, etc.
2. **External systems** — GRC exports, provisioning pushes (existing).

All integration endpoints must validate an API key (`PROVISUM_API_KEY` env var) in the `Authorization` header. Do not expose integration endpoints without auth.

### What NOT to do

- **Do not add a portfolio management UI.** Portfolios are a Cursus concept. The `portfolio_id` FK is an integration hook, not a Provisum feature.
- **Do not create a separate personas table for Cursus sync.** Personas are one table, one source of truth. Security metadata goes in `rm_`-prefixed tables that FK to the shared `personas.id`.
- **Do not hardcode single-tenant assumptions.** Every query should include `organization_id` in its WHERE clause (or rely on RLS). Never assume there is only one organization.
- **Do not build Cursus-to-Provisum sync.** The sync direction is Provisum → Cursus only. If you find yourself needing to pull data from Cursus into Provisum, stop and reconsider the architecture.
- **Do not rename the `releases` table or its scoping junction tables** (`release_users`, `release_org_units`, etc.). These are Provisum-specific and well-established. They will be prefixed `rm_` in embedded mode but keep their current names in standalone.

---

## E2E Testing (Playwright)

**46 tests** across 9 spec files. Run with `npx playwright test` (or `pnpm test:e2e`).

### Architecture
- **Config**: `playwright.config.ts` — serial execution (`workers: 1`), 120s test timeout, 1 retry, Chromium only
- **Global setup**: `e2e/global-setup.ts` — pre-authenticates 6 test users via API, saves cookies to `e2e/.auth/*.json`
- **Auth helper**: `e2e/helpers/auth.ts` — 3 login strategies:
  1. **Storage state** (default) — loads pre-saved cookies, navigates directly to target page
  2. **API fallback** — `POST /api/auth/login` if cookies expired, retries once on timeout
  3. **Form login** (`loginViaForm`) — only for tests that specifically test the login UI
- **Direct navigation**: `login(page, user, undefined, "/target-page")` skips intermediate `/dashboard` goto — critical for dev server performance

### Key patterns & gotchas
- **React hydration**: `fill()` on controlled inputs before React hydrates doesn't update state. Fix: `networkidle` wait + `click()` before `fill()` + `toBeEnabled()` check before submit
- **Welcome tour overlay**: `fixed inset-0 z-50` blocks pointer events. Dismiss with "Skip Tour" button click before sidebar navigation
- **Strict mode selectors**: Scope sidebar links to `aside nav` with `{ exact: true }`. Use `.first()` for repeated text like "Provisum"
- **Admin console**: Requires `system_admin` role (not `admin`). Use `sysadmin` user for admin tests
- **Dev server exhaustion**: After ~35 sequential tests, the Next.js dev server slows. Mitigated by: storage state auth (6 API calls vs 46), direct navigation, `waitUntil: "commit"` for heavy pages, 1 retry
- **Heavy pages**: `/mapping`, `/sod`, `/calibration` need extended timeouts (45-90s) under server load

### Spec files
| File | Tests | What it covers |
|------|-------|---------------|
| `admin-features.spec.ts` | 8 | Admin console tabs, security design, audit log |
| `approvals.spec.ts` | 2 | Approver queue, viewer read-only |
| `auth.spec.ts` | 4 | Form login, invalid creds, unauthorized redirect, role blocking |
| `dashboard.spec.ts` | 3 | Stat cards, sidebar nav, navigation |
| `error-states.spec.ts` | 5 | 404, disabled button states, failed login |
| `full-workflow.spec.ts` | 8 | Admin page traversal (7 pages), mapper personas+mapping |
| `mapping-workflow.spec.ts` | 3 | Personas, mapping, SOD pages |
| `notifications.spec.ts` | 3 | Inbox access, sidebar link |
| `role-access-matrix.spec.ts` | 10 | /admin blocked for 5 roles, /calibration blocked for viewer, positive spot checks |

### Running tests
```bash
# Full suite (Playwright starts dev server automatically if port 3000 is free)
npx playwright test

# Single spec file
npx playwright test e2e/auth.spec.ts

# With visible browser
npx playwright test --headed

# View last HTML report
npx playwright show-report
```

**Important**: If a dev server is already running on port 3000, Playwright reuses it (`reuseExistingServer: true`). If port 3000 is occupied by something else, Playwright will start on a different port and tests will fail because `baseURL` is hardcoded to `localhost:3000`.

---

## Common gotchas

1. **`inArray` with nullable types** — always filter nulls first:
   ```ts
   .filter((id): id is number => id !== null)
   ```

2. **`new Set` iteration** — use `Array.from(new Set(...))` for ES target compatibility, not spread.

3. **Multiple Edit matches** — when editing `queries.ts`, always include enough surrounding context lines to uniquely identify the location.

4. **`isActive` field** — when selecting `appUsers`, if you don't need `isActive` in the returned type, select it and strip it with `.map(({ isActive: _ia, ...rest }) => rest)`.

5. **Schema changes require `pnpm db:push`** — don't forget after adding tables or columns.

6. **`force-dynamic`** — any page that reads from the DB or session must have `export const dynamic = "force-dynamic"` or it will be statically cached at build time.

7. **Deployment (current)** — Vercel (target). Database: Supabase Postgres (persistent, managed). Required env vars: `DATABASE_URL` (Supabase pooled connection string), `ANTHROPIC_API_KEY`, `ENCRYPTION_KEY`. Data persists across deploys — run `pnpm db:push` once to create tables, then `pnpm db:seed` to seed initial data. AI pipeline routes have `maxDuration = 300` for Vercel.

8. **AI pipeline** — Persona generation uses a 2-phase approach: AI analyzes a 100-user sample to design personas, then programmatic permission-overlap matching assigns all users. This prevents JSON truncation. Jobs run fire-and-forget in background; client polls `/api/jobs/[id]` for status.

9. **Self-guided demo accounts** — `demo.admin`, `demo.mapper.finance`, `demo.approver`, `demo.viewer`, `demo.coordinator`, `demo.pm` (all password `DemoGuide2026!`). Always created in every seed. Quick-login pills shown on login page.

10. **`maxDuration` on heavy pages** — Pages that run multiple DB queries (dashboard, risk-analysis, mapping, admin/validation, releases/compare) export `maxDuration = 60` to extend Vercel's serverless function timeout. AI pipeline routes use `maxDuration = 300`.

---

## File map for common tasks

| Task | Files to touch |
|------|---------------|
| Add a setting | `lib/settings.ts` (document key), `app/admin/admin-console-client.tsx` |
| Add a new role | `lib/auth.ts` (ROLE_HIERARCHY), `lib/scope.ts`, `app/admin/users/users-client.tsx` |
| Add a DB table | `db/schema.ts`, then `pnpm db:push` |
| Add a new query | `lib/queries/<domain>.ts` + re-export from `lib/queries/index.ts` |
| New dashboard section | `app/dashboard/page.tsx` (data), `app/dashboard/dashboard-filtered.tsx` (UI) |
| New sidebar nav item | `components/layout/sidebar.tsx` |
| New API mutation | `app/api/<path>/route.ts` |
| Validation dashboard | `app/admin/validation/`, `app/api/admin/validation/` |
| Change strapline language | `lib/strapline.ts` |
| Change notification template | `app/notifications/notifications-client.tsx` (QUICK_MESSAGES) |
| AI pipeline internals | `lib/ai/types.ts` (shared interfaces), `lib/ai/load-user-profiles.ts` (bulk loader) |
| Add Lumen tool | `lib/assistant/tools.ts` (define + handler), `app/api/assistant/chat/route.ts` (status label) |
| AI mapping suggestions | `lib/ai/mapping-suggestions.ts`, `app/api/mapping/ai-suggestions/`, `app/mapping/ai-suggestions-modal.tsx` |
| Target system adapter | `lib/adapters/`, `app/admin/security-design/`, `app/api/admin/security-design/` |
| Email settings | `app/admin/email-settings-section.tsx`, `app/api/admin/test-email/route.ts` |
| E2E tests | `e2e/`, `playwright.config.ts`, `e2e/helpers/auth.ts`, `e2e/global-setup.ts` |
| Add feature flag | `lib/feature-flags.ts` (use `isFeatureEnabled()`), `db/seed.ts` (default value) |
| Add webhook event | `lib/webhooks.ts` (add type), dispatch in the relevant API route |
| Org-scoped query | `lib/org-context.ts` (use `orgScope()` or `withOrgFilter()` in WHERE clause) |
| Email notification | `lib/email.ts` (`sendNotificationEmail()`), `lib/notifications.ts` |
| Admin console tab | `app/admin/admin-console-client.tsx` (add TabsTrigger + TabsContent) |
| Incident detection | `lib/incidents/detection.ts` (`detectIncident()`), `lib/incidents/triage.ts` |
| Incidents admin UI | `app/admin/incidents/`, `app/api/admin/incidents/` |
| Migration health dashboard | `lib/queries/migration-health.ts`, `app/admin/migration-health/` |
| Activity pulse widget | `app/admin/activity-pulse.tsx`, `app/api/admin/activity-pulse/route.ts` |
| SOD heatmap | `app/sod/sod-heatmap.tsx` (imported by `sod-client.tsx`) |
| Release readiness checklist | `app/releases/releases-client.tsx` (ReadinessChecklist component) |
| Confidence distribution chart | `app/calibration/page.tsx` (ConfidenceChart server component) |
| Target role editing/approval | `app/target-roles/role-edit-dialog.tsx`, `app/api/target-roles/[id]/route.ts`, `app/api/target-roles/[id]/approve/route.ts` |
| Mitigating controls | `app/sod/resolution-dialogs.tsx` (control section), `app/api/sod/accept-risk/route.ts`, `lib/queries/risk.ts` (controlsCoverage) |
| SSO configuration | `app/admin/sso-tab.tsx`, `app/api/admin/sso/`, `app/api/auth/sso/route.ts`, `app/login/login-form.tsx` |
| Security design export | `app/api/exports/security-design/route.ts` (3-sheet Excel), `app/workspace/security/security-client.tsx` (export button) |
