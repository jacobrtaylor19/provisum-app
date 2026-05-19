-- ─────────────────────────────────────────────────────────────────────────────
-- Sprint 1 Defensibility Chassis — SQL Migration
-- UX Brief Phase A1 (QW.2, A1.2) + schema additions
-- Date: 2026-05-19
--
-- Apply via:
--   DATABASE_URL=$(vercel env pull --environment=production) psql $DATABASE_URL -f db/migrations/sprint1_defensibility.sql
--
-- Or using the project's postgres-js client:
--   node db/migrations/apply-sprint1.js
--
-- Safe to run multiple times (uses IF NOT EXISTS / OR REPLACE throughout).
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────
-- A1.1: Add hash column to evidence_package_runs
-- ─────────────────────────────────────────────

ALTER TABLE evidence_package_runs
  ADD COLUMN IF NOT EXISTS hash text;

COMMENT ON COLUMN evidence_package_runs.hash IS
  'SHA-256 hex digest of the generated export payload. Set by emitIntegrityHash() after generation. NULL on legacy rows created before Sprint 1.';

-- ─────────────────────────────────────────────
-- A1.2: Append-only history tables
--
-- These tables capture a full JSON snapshot of every INSERT, UPDATE, and
-- DELETE on the three highest-priority evidence-persistent tables. They enable
-- point-in-time reproducibility: "What was assignment row 42 at go-live?"
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_persona_assignments_history (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  original_row_id integer NOT NULL,
  org_id      integer     NOT NULL DEFAULT 0,
  snapshot_json text      NOT NULL,
  changed_by  text        NOT NULL DEFAULT 'system',
  changed_at  text        NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  change_kind text        NOT NULL  -- 'insert' | 'update' | 'delete'
);

COMMENT ON TABLE user_persona_assignments_history IS
  'Append-only audit history for user_persona_assignments. Populated by Postgres trigger. Read-only from application code.';

CREATE TABLE IF NOT EXISTS persona_target_role_mappings_history (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  original_row_id integer NOT NULL,
  org_id      integer     NOT NULL DEFAULT 0,
  snapshot_json text      NOT NULL,
  changed_by  text        NOT NULL DEFAULT 'system',
  changed_at  text        NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  change_kind text        NOT NULL
);

COMMENT ON TABLE persona_target_role_mappings_history IS
  'Append-only audit history for persona_target_role_mappings. Populated by Postgres trigger.';

CREATE TABLE IF NOT EXISTS sod_conflicts_history (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  original_row_id integer NOT NULL,
  org_id      integer     NOT NULL DEFAULT 0,
  snapshot_json text      NOT NULL,
  changed_by  text        NOT NULL DEFAULT 'system',
  changed_at  text        NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  change_kind text        NOT NULL
);

COMMENT ON TABLE sod_conflicts_history IS
  'Append-only audit history for sod_conflicts. Populated by Postgres trigger.';

-- ─────────────────────────────────────────────
-- QW.2: Append-only enforcement on audit_log
--
-- Postgres trigger that rejects any UPDATE or DELETE on audit_log rows.
-- This makes the audit log tamper-evident at the DB level — even a DB admin
-- cannot silently alter past entries without the trigger firing.
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'audit_log is append-only. % operations are not permitted. '
    'Contact the Provisum platform team if this is a legitimate administrative action.',
    TG_OP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

COMMENT ON FUNCTION prevent_audit_log_mutation() IS
  'Enforces append-only semantics on audit_log. Installed as part of QW.2 (UX brief Sprint 1).';

-- ─────────────────────────────────────────────
-- A1.2: History capture triggers
--
-- Each trigger captures a row snapshot on INSERT, UPDATE, or DELETE.
-- The snapshot is stored as a JSON text string (to_json(row)::text).
--
-- org_id sourcing:
--   - user_persona_assignments: no direct org_id column; look up via users table
--   - persona_target_role_mappings: no direct org_id column; look up via personas table
--   - sod_conflicts: direct organization_id column
--
-- changed_by: reads the session variable 'provisum.actor' if set by the
--   application (SET LOCAL provisum.actor = 'user@example.com'). Falls back
--   to 'system'. The application does not currently set this variable;
--   the authoritative actor record is in audit_log. Setting it is a Phase A2
--   enhancement for stronger trigger-level attribution.
-- ─────────────────────────────────────────────

-- user_persona_assignments → user_persona_assignments_history

CREATE OR REPLACE FUNCTION capture_user_persona_assignment_history()
RETURNS TRIGGER AS $$
DECLARE
  v_row   user_persona_assignments;
  v_org   integer;
  v_actor text;
BEGIN
  v_row   := CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  v_actor := COALESCE(current_setting('provisum.actor', true), 'system');

  -- Resolve org_id via users table (user_persona_assignments has no direct org_id)
  SELECT organization_id INTO v_org FROM users WHERE id = v_row.user_id LIMIT 1;
  v_org := COALESCE(v_org, 0);

  INSERT INTO user_persona_assignments_history (
    original_row_id, org_id, snapshot_json, changed_by, changed_at, change_kind
  ) VALUES (
    v_row.id,
    v_org,
    to_json(v_row)::text,
    v_actor,
    to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    lower(TG_OP)
  );

  RETURN v_row;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_persona_assignments_history_trigger ON user_persona_assignments;
CREATE TRIGGER user_persona_assignments_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON user_persona_assignments
  FOR EACH ROW EXECUTE FUNCTION capture_user_persona_assignment_history();

-- persona_target_role_mappings → persona_target_role_mappings_history

CREATE OR REPLACE FUNCTION capture_persona_target_role_mapping_history()
RETURNS TRIGGER AS $$
DECLARE
  v_row   persona_target_role_mappings;
  v_org   integer;
  v_actor text;
BEGIN
  v_row   := CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  v_actor := COALESCE(current_setting('provisum.actor', true), 'system');

  -- Resolve org_id via personas table
  SELECT organization_id INTO v_org FROM personas WHERE id = v_row.persona_id LIMIT 1;
  v_org := COALESCE(v_org, 0);

  INSERT INTO persona_target_role_mappings_history (
    original_row_id, org_id, snapshot_json, changed_by, changed_at, change_kind
  ) VALUES (
    v_row.id,
    v_org,
    to_json(v_row)::text,
    v_actor,
    to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    lower(TG_OP)
  );

  RETURN v_row;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS persona_target_role_mappings_history_trigger ON persona_target_role_mappings;
CREATE TRIGGER persona_target_role_mappings_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON persona_target_role_mappings
  FOR EACH ROW EXECUTE FUNCTION capture_persona_target_role_mapping_history();

-- sod_conflicts → sod_conflicts_history

CREATE OR REPLACE FUNCTION capture_sod_conflict_history()
RETURNS TRIGGER AS $$
DECLARE
  v_row   sod_conflicts;
  v_actor text;
BEGIN
  v_row   := CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  v_actor := COALESCE(current_setting('provisum.actor', true), 'system');

  INSERT INTO sod_conflicts_history (
    original_row_id, org_id, snapshot_json, changed_by, changed_at, change_kind
  ) VALUES (
    v_row.id,
    COALESCE(v_row.organization_id, 0),
    to_json(v_row)::text,
    v_actor,
    to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    lower(TG_OP)
  );

  RETURN v_row;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sod_conflicts_history_trigger ON sod_conflicts;
CREATE TRIGGER sod_conflicts_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON sod_conflicts
  FOR EACH ROW EXECUTE FUNCTION capture_sod_conflict_history();

-- ─────────────────────────────────────────────
-- Verification queries (run manually to confirm)
-- ─────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'evidence_package_runs';
-- SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%history%';
-- SELECT trigger_name, event_object_table FROM information_schema.triggers WHERE trigger_schema = 'public' ORDER BY 2;
-- To test QW.2: UPDATE audit_log SET actor_email = 'test' WHERE id = 1; -- should error
