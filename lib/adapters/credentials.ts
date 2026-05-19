/**
 * Adapter Credential Vault — lib/adapters/credentials.ts
 *
 * Secure per-org storage for target-system adapter credentials.
 * Secrets are AES-256-GCM encrypted at rest using ENCRYPTION_KEY.
 * The plaintext blob is NEVER returned to callers — only metadata is exposed.
 * Decryption happens in-process only at connection-test time.
 *
 * Usage:
 *   const id = await storeCredential(orgId, "sap_s4hana", "Prod SAP", { username, password, host });
 *   const creds = await getDecryptedCredentials(id, orgId); // for use inside adapters only
 *   const list  = await listCredentials(orgId);             // metadata only, no secrets
 */

import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { encrypt, decrypt } from "@/lib/encryption";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type AdapterType = "sap_s4hana" | "workday" | "oracle_fusion" | "servicenow";

/**
 * Plaintext credential payload — stored encrypted, never serialized to API responses.
 * Fields are optional; each adapter type uses the relevant subset.
 */
export interface CredentialPayload {
  // Hostname / base URL (SAP application server, Workday API URL, etc.)
  host?: string;
  // Username/password auth (SAP dialog user, ServiceNow user)
  username?: string;
  password?: string;
  // SAP-specific
  client?: string;       // SAP client number, e.g. "100"
  systemId?: string;     // SAP System ID (SID)
  // OAuth 2.0 (Workday, Oracle Fusion)
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
  // API-key-based (ServiceNow)
  apiKey?: string;
  // Arbitrary extra fields for adapter-specific config
  [key: string]: string | undefined;
}

/**
 * Public metadata returned by API — no secrets included.
 */
export interface CredentialMeta {
  id: number;
  organizationId: number;
  adapterType: AdapterType;
  name: string;
  isActive: boolean;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────
// Vault operations
// ─────────────────────────────────────────────────────────────────

/**
 * Store a new credential set. Encrypts the payload before writing.
 * Returns the new credential record ID.
 */
export async function storeCredential(
  organizationId: number,
  adapterType: AdapterType,
  name: string,
  payload: CredentialPayload,
): Promise<number> {
  const credentialsEnc = encrypt(JSON.stringify(payload));
  const [row] = await db
    .insert(schema.adapterCredentials)
    .values({ organizationId, adapterType, name, credentialsEnc })
    .returning({ id: schema.adapterCredentials.id });
  return row.id;
}

/**
 * Update an existing credential set (replace payload and/or name).
 * Caller must own the record (same orgId). Throws if not found.
 */
export async function updateCredential(
  id: number,
  organizationId: number,
  updates: { name?: string; payload?: CredentialPayload; isActive?: boolean },
): Promise<void> {
  const [existing] = await db
    .select({ id: schema.adapterCredentials.id })
    .from(schema.adapterCredentials)
    .where(
      and(
        eq(schema.adapterCredentials.id, id),
        eq(schema.adapterCredentials.organizationId, organizationId),
      ),
    );

  if (!existing) {
    throw new Error(`Credential ${id} not found for org ${organizationId}`);
  }

  const setFields: Partial<typeof schema.adapterCredentials.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (updates.name !== undefined) setFields.name = updates.name;
  if (updates.isActive !== undefined) setFields.isActive = updates.isActive;
  if (updates.payload !== undefined) {
    setFields.credentialsEnc = encrypt(JSON.stringify(updates.payload));
  }

  await db
    .update(schema.adapterCredentials)
    .set(setFields)
    .where(eq(schema.adapterCredentials.id, id));
}

/**
 * Delete a credential record. Caller must own the record.
 */
export async function deleteCredential(id: number, organizationId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.adapterCredentials.id })
    .from(schema.adapterCredentials)
    .where(
      and(
        eq(schema.adapterCredentials.id, id),
        eq(schema.adapterCredentials.organizationId, organizationId),
      ),
    );

  if (!row) return false;

  await db
    .delete(schema.adapterCredentials)
    .where(eq(schema.adapterCredentials.id, id));

  return true;
}

/**
 * List all credential metadata for an org (no plaintext secrets).
 */
export async function listCredentials(organizationId: number): Promise<CredentialMeta[]> {
  const rows = await db
    .select({
      id: schema.adapterCredentials.id,
      organizationId: schema.adapterCredentials.organizationId,
      adapterType: schema.adapterCredentials.adapterType,
      name: schema.adapterCredentials.name,
      isActive: schema.adapterCredentials.isActive,
      lastTestedAt: schema.adapterCredentials.lastTestedAt,
      lastTestStatus: schema.adapterCredentials.lastTestStatus,
      createdAt: schema.adapterCredentials.createdAt,
      updatedAt: schema.adapterCredentials.updatedAt,
    })
    .from(schema.adapterCredentials)
    .where(eq(schema.adapterCredentials.organizationId, organizationId));

  return rows.map(toMeta);
}

/**
 * Get a single credential's metadata (no secrets).
 * Returns null if not found or wrong org.
 */
export async function getCredentialMeta(
  id: number,
  organizationId: number,
): Promise<CredentialMeta | null> {
  const [row] = await db
    .select({
      id: schema.adapterCredentials.id,
      organizationId: schema.adapterCredentials.organizationId,
      adapterType: schema.adapterCredentials.adapterType,
      name: schema.adapterCredentials.name,
      isActive: schema.adapterCredentials.isActive,
      lastTestedAt: schema.adapterCredentials.lastTestedAt,
      lastTestStatus: schema.adapterCredentials.lastTestStatus,
      createdAt: schema.adapterCredentials.createdAt,
      updatedAt: schema.adapterCredentials.updatedAt,
    })
    .from(schema.adapterCredentials)
    .where(
      and(
        eq(schema.adapterCredentials.id, id),
        eq(schema.adapterCredentials.organizationId, organizationId),
      ),
    );

  return row ? toMeta(row) : null;
}

/**
 * Decrypt and return the full credential payload.
 * FOR INTERNAL ADAPTER USE ONLY — never pass this to API responses.
 * Throws if the record is not found or decryption fails.
 */
export async function getDecryptedCredentials(
  id: number,
  organizationId: number,
): Promise<CredentialPayload> {
  const [row] = await db
    .select({
      credentialsEnc: schema.adapterCredentials.credentialsEnc,
      organizationId: schema.adapterCredentials.organizationId,
    })
    .from(schema.adapterCredentials)
    .where(
      and(
        eq(schema.adapterCredentials.id, id),
        eq(schema.adapterCredentials.organizationId, organizationId),
      ),
    );

  if (!row) {
    throw new Error(`Credential ${id} not found for org ${organizationId}`);
  }

  const plaintext = decrypt(row.credentialsEnc);
  return JSON.parse(plaintext) as CredentialPayload;
}

/**
 * Record the result of a connection test (called after adapter.testConnection()).
 */
export async function recordTestResult(
  id: number,
  status: "success" | "failed",
): Promise<void> {
  await db
    .update(schema.adapterCredentials)
    .set({
      lastTestedAt: new Date().toISOString(),
      lastTestStatus: status,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.adapterCredentials.id, id));
}

// ─────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────

function toMeta(row: {
  id: number;
  organizationId: number;
  adapterType: string;
  name: string;
  isActive: boolean;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  createdAt: string;
  updatedAt: string;
}): CredentialMeta {
  return {
    id: row.id,
    organizationId: row.organizationId,
    adapterType: row.adapterType as AdapterType,
    name: row.name,
    isActive: row.isActive,
    lastTestedAt: row.lastTestedAt ?? null,
    lastTestStatus: row.lastTestStatus ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
