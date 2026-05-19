-- ─────────────────────────────────────────────────────────────────────────────
-- Sprint 2 — Adapter Credential Vault
-- Work item #34: Credential vault for adapter connection secrets
-- Date: 2026-05-19
--
-- Adds:
--   adapter_credentials — per-org AES-256-GCM encrypted storage for
--   target-system adapter credentials (SAP, Workday, Oracle, ServiceNow).
--
-- Safe to re-run (uses IF NOT EXISTS).
-- Apply via: node db/migrations/apply-sprint2.mjs
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS adapter_credentials (
  id                  serial      PRIMARY KEY,
  organization_id     integer     NOT NULL REFERENCES organizations(id),
  -- Which adapter family these credentials belong to
  adapter_type        text        NOT NULL,  -- 'sap_s4hana' | 'workday' | 'oracle_fusion' | 'servicenow'
  -- Human-friendly label set by the admin (e.g. "Production SAP", "HR Workday")
  name                text        NOT NULL,
  -- AES-256-GCM encrypted JSON blob — plaintext NEVER exposed via API
  credentials_enc     text        NOT NULL,
  is_active           boolean     NOT NULL DEFAULT true,
  -- ISO 8601 timestamp of last connection test
  last_tested_at      text,
  -- 'success' | 'failed' | NULL (not yet tested)
  last_test_status    text,
  created_at          text        NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  updated_at          text        NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

COMMENT ON TABLE adapter_credentials IS
  'Per-org encrypted storage for target-system adapter credentials. '
  'Secrets are AES-256-GCM encrypted via ENCRYPTION_KEY. '
  'Plaintext is never returned by the API — decryption happens in-process at connection time. '
  'Managed by lib/adapters/credentials.ts.';

COMMENT ON COLUMN adapter_credentials.credentials_enc IS
  'AES-256-GCM encrypted JSON blob in format iv:authTag:ciphertext (all base64). '
  'Decrypt using lib/encryption.ts decrypt(). Never expose this column in API responses.';

-- Index for the common query pattern: list all credentials for an org
CREATE INDEX IF NOT EXISTS adapter_credentials_org_idx
  ON adapter_credentials (organization_id);

-- Verification query (run manually to confirm):
-- SELECT id, organization_id, adapter_type, name, is_active, last_test_status
--   FROM adapter_credentials LIMIT 5;
