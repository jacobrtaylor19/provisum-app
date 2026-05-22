/**
 * POST /api/admin/adapter-credentials/[id]/test
 *
 * Decrypts the stored credential, instantiates the matching adapter,
 * calls testConnection(), and persists the result.
 * Returns { connected, message } to the caller.
 *
 * Access: admin, system_admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { getOrgId } from "@/lib/org-context";
import { getCredentialMeta, getDecryptedCredentials, recordTestResult } from "@/lib/adapters/credentials";
import { getAdapter } from "@/lib/adapters";
import { auditLog } from "@/lib/audit";
import { reportError } from "@/lib/monitoring";

type RouteParams = { params: { id: string } };

export async function POST(_req: NextRequest, { params }: RouteParams) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await requireRole(["admin", "system_admin"]);

    const id = parseInt(params.id, 10);
    if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const orgId = getOrgId(user);
    const meta = await getCredentialMeta(id, orgId);
    if (!meta) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Decrypt credentials — only happens in-process at connection time
    const payload = await getDecryptedCredentials(id, orgId);

    // Instantiate the adapter with the decrypted config
    const adapter = getAdapter(meta.adapterType, payload);
    const result = await adapter.testConnection();

    const status = result.connected ? "success" : "failed";
    await recordTestResult(id, status);

    await auditLog({
      actorEmail: user.email ?? "unknown",
      action: "adapter_credential.tested",
      entityType: "adapter_credentials",
      entityId: id,
      organizationId: orgId,
      metadata: { adapterType: meta.adapterType, connected: result.connected },
    });

    return NextResponse.json({ connected: result.connected, message: result.message });
  } catch (err) {
    reportError(err, { context: `POST /api/admin/adapter-credentials/${params.id}/test` });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
