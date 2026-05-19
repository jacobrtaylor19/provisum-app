-- ─────────────────────────────────────────────────────────────────────────────
-- Sprint 3 — UUID Migration Phase 1 (shadow columns)
-- Work item #47: UUID primary keys for all Provisum tables (Cursus alignment)
-- Date: 2026-05-19
-- ADR: docs/architecture/ADR_003_UUID_Migration.md
--
-- Adds id_uuid uuid NOT NULL DEFAULT gen_random_uuid() to all 57 live tables.
-- PURELY ADDITIVE — no existing column is modified, no FK is touched, no
-- application code changes required. Zero downtime.
--
-- Phase 2 (future sprint) will swap the PKs and update FK columns.
-- Phase 3 will update db/schema.ts to use uuid() types.
-- Phase 4 will update application code (parseInt → string, etc.).
--
-- Postgres 11+ executes ADD COLUMN ... DEFAULT without a table rewrite.
-- Supabase uses Postgres 15+ so this is safe.
--
-- Safe to re-run (uses IF NOT EXISTS / idempotent).
-- Apply via: node db/migrations/apply-sprint3.mjs
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable pgcrypto if not already (needed for gen_random_uuid() on older pg)
-- Supabase enables this by default; this is a safety net.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────
-- TIER 0 — No enforced FK parents (roots)
-- ─────────────────────────────────────────────

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE processing_jobs
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE rate_limit_entries
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE feature_flags
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE demo_leads
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE provisioning_requests
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE webhook_endpoints
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE scheduled_exports
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE source_permissions
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE target_permissions
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE target_task_roles
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE sod_rules
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE org_units
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE source_roles
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE consolidated_groups
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE target_roles
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE releases
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE workstream_items
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE security_work_items
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE evidence_package_runs
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

-- ─────────────────────────────────────────────
-- TIER 1 — Depends only on Tier 0
-- ─────────────────────────────────────────────

ALTER TABLE source_role_permissions
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE user_source_role_assignments
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE personas
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE target_task_role_permissions
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE target_security_role_tasks
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE target_role_permissions
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE release_users
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE release_org_units
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE release_source_roles
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE release_target_roles
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE release_sod_rules
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE user_gap_reviews
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE sso_configurations
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE adapter_credentials
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE security_design_changes
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE user_invites
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE app_user_sessions
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE work_assignments
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE review_links
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

-- ─────────────────────────────────────────────
-- TIER 2 — Depends on Tier 1
-- ─────────────────────────────────────────────

ALTER TABLE persona_source_permissions
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE user_persona_assignments
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE persona_target_role_mappings
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE least_access_exceptions
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE permission_gaps
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE mapping_feedback
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE persona_confirmations
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE app_user_releases
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE sod_conflicts
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

-- ─────────────────────────────────────────────
-- TIER 3 — Depends on Tier 2
-- ─────────────────────────────────────────────

ALTER TABLE user_target_role_assignments
  ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

-- ─────────────────────────────────────────────
-- VERIFICATION
-- ─────────────────────────────────────────────
-- After applying, confirm all 57 tables have the column:
--
--   SELECT table_name, column_name, data_type, column_default
--     FROM information_schema.columns
--    WHERE column_name = 'id_uuid'
--      AND table_schema = 'public'
--    ORDER BY table_name;
--
-- Expected: 57 rows.
--
-- History tables (user_persona_assignments_history, persona_target_role_mappings_history,
-- sod_conflicts_history) already use uuid PKs — they are excluded from this migration.
-- ─────────────────────────────────────────────
