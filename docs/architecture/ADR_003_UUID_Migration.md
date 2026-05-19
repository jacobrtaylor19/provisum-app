# ADR-003 — UUID Primary Keys for All Live Tables

**Status:** Accepted — Phase 1 in progress  
**Date:** 2026-05-19  
**Author:** Jacob Taylor  
**Work Item:** #47 — UUID primary keys (Cursus schema alignment)

---

## Context

Provisum is designed to embed inside Cursus as the Role Mapping SKU. The Cursus schema alignment spec
(`docs/Provisum_Cursus_Architectural_Alignment.md`, Rule 1) requires all primary keys to be `uuid`
with `DEFAULT gen_random_uuid()`. This enables:

- **Cross-system joins** — Cursus links entities by UUID across shared tables (personas, organizations,
  releases). Serial integers break those joins because sequences are per-database.
- **Multi-region/multi-tenant key uniqueness** — UUIDs are globally unique without coordination.
- **Event-sourcing / audit logs** — The history tables (`*_history`) already use UUID PKs (ADR-002).
  The live tables must follow so `original_row_id` can eventually become a typed UUID FK.
- **API safety** — Integer PKs are enumerable and leak cardinality information. UUIDs are opaque.

The 57 live tables currently use `serial` (integer sequence) PKs. The 3 history tables already use
`uuid` PKs and are excluded from this migration.

---

## Decision

Migrate all 57 live tables from `serial` PKs to `uuid` PKs via a **4-phase rolling migration**.
Each phase is independently deployable with no downtime.

---

## Migration Phases

### Phase 1 — Shadow UUID columns (this sprint, #47)

Add `id_uuid uuid NOT NULL DEFAULT gen_random_uuid()` to every live table. Purely additive — no
existing column is touched, no FK is modified, no application code changes. Deploy immediately.

```sql
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();
-- ... repeated for all 57 tables
```

**Risk:** Zero. Additive DDL. Postgres adds the column with a default — no table rewrite for
`NOT NULL` with a `DEFAULT` (Postgres 11+, which Supabase satisfies).

**App code:** No changes. App still reads/writes integer `id` column exclusively.

---

### Phase 2 — PK swap (future sprint, 2-4 weeks)

For each table in topological order (see below), in a single transaction per table:

1. Drop the `SERIAL` default from the old `id` column
2. Rename `id` → `id_legacy` (or drop after backfill — see note)
3. Rename `id_uuid` → `id`
4. Add `PRIMARY KEY` constraint on the new `id`
5. Update FK columns in child tables that reference this table's old integer PK

**Topological migration order** (Phase 2 must follow this — parent tables before children):

**Tier 0 — No enforced FK parents (migrate first):**
```
organizations, processingJobs, systemSettings, rateLimitEntries, featureFlags,
demoLeads, provisioningRequests, webhookEndpoints, webhookDeliveries, scheduledExports,
chatConversations, sourcePermissions, targetPermissions, targetTaskRoles,
orgUnits*, users*, sourceRoles*, consolidatedGroups*, targetRoles*, releases*,
workstreamItems*, auditLog*, appUsers*, sodRules*, securityWorkItems*, evidencePackageRuns*
```
*Soft FKs only (no `.references()` in Drizzle schema, no DB-enforced constraint) — can be
  treated as roots for Phase 2 ordering.

**Tier 1 — Depends only on Tier 0:**
```
sourceRolePermissions, userSourceRoleAssignments, personas, targetTaskRolePermissions,
targetSecurityRoleTasks, targetRolePermissions, releaseUsers, releaseOrgUnits,
releaseSourceRoles, releaseTargetRoles, releaseSodRules, userGapReviews,
ssoConfigurations, adapterCredentials, securityDesignChanges, userInvites,
appUserSessions, workAssignments, reviewLinks, notifications, incidents
```

**Tier 2 — Depends on Tier 1:**
```
personaSourcePermissions, userPersonaAssignments, personaTargetRoleMappings,
leastAccessExceptions, permissionGaps, mappingFeedback, personaConfirmations,
appUserReleases, sodConflicts
```

**Tier 3 — Depends on Tier 2:**
```
userTargetRoleAssignments
```

**Note on FK columns:** Many `organizationId`, `userId`, `releaseId` columns in child tables have
no `.references()` in the Drizzle schema (soft FKs). These still hold integer values referencing
parent integer PKs. During Phase 2 they must be migrated from `integer` → `uuid` and filled with
the new UUID values by joining against the parent table's `id_legacy` column. The soft-FK columns
make this more work than the enforced-FK columns (which Postgres tracks automatically via
`information_schema.referential_constraints`).

---

### Phase 3 — Drizzle schema update (after Phase 2)

Update `db/schema.ts` to use `uuid("id").primaryKey().defaultRandom()` instead of
`serial("id").primaryKey()` for all 57 tables. All FK columns change from `integer()` → `uuid()`.
Run `pnpm db:push` (or a migration) to reconcile.

---

### Phase 4 — Application code cleanup (after Phase 3)

- Update TypeScript types — `id` fields change from `number` → `string` throughout
- Update `parseInt(params.id, 10)` → `params.id` in all API route handlers (no parsing needed)
- Update `getOrgId()` return type
- Update seed scripts
- Drop `id_legacy` columns
- Update the history table `original_row_id integer` → `original_row_id uuid`

---

## Alternatives Considered

### Keep serial PKs, use UUID only at API boundary

Generate UUIDs externally and map to integer IDs at the API layer. Rejected — adds a mapping
table that would need to be joined on every request and does not satisfy the Cursus schema
alignment requirement for shared tables.

### Migrate all phases in one big bang

Do Phase 2-4 in a single deployment window. Rejected — too risky for a live production app.
Rolling phases allow individual rollback without affecting the others.

### Use `gen_random_uuid()` at application layer (not DB default)

Generate UUIDs in Drizzle's `$defaultFn`. Rejected — DB-level default (`DEFAULT gen_random_uuid()`)
ensures uniqueness even for rows inserted via raw SQL, migration scripts, or Supabase Studio.

---

## Consequences

**Positive:**
- Cursus schema alignment satisfied — embedded mode becomes feasible
- Globally unique IDs across environments (no demo/prod collision)
- Safer external API — IDs are opaque

**Negative:**
- Phase 2 requires careful per-table migration scripts with FK backfill — significant effort (~1 sprint)
- Application code changes are broad (every file that parses `parseInt(params.id)`)
- UUIDs are 16 bytes vs 4 bytes for serial integers — minor index size increase, negligible at this scale

---

## Files

| File | Purpose |
|------|---------|
| `db/migrations/sprint3_uuid_phase1.sql` | Phase 1 SQL — adds shadow `id_uuid` columns to all 57 tables |
| `db/migrations/apply-sprint3.mjs` | Runner script for Phase 1 SQL |
| `db/schema.ts` | Updated in Phase 3 (not yet) |

---

## References

- `docs/Provisum_Cursus_Architectural_Alignment.md` — Cursus schema alignment rules
- `db/migrations/sprint2_credential_vault.sql` — Precedent for raw SQL migration pattern
- Postgres docs: [ALTER TABLE ... ADD COLUMN with DEFAULT (no table rewrite)](https://www.postgresql.org/docs/current/sql-altertable.html)
- ADR-002 — History tables (already use UUID PKs — see `db/schema.ts` `*_history` tables)
