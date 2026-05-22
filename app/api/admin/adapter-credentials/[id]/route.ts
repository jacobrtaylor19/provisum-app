/**
 * GET    /api/admin/adapter-credentials/[id]        — credential metadata (no secrets)
 * PUT    /api/admin/adapter-credentials/[id]        — update name / payload / isActive
 * DELETE /api/admin/adapter-credentials/[id]        — delete credential record
 * POST   /api/admin/adapter-credentials/[id]/test  — handled in /[id]/test/route.ts
 *
 * Access: admin, system_admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { getOrgId } from "@/lib/org-context";
import {
  getCredentialMeta,
  updateCredential,
  deleteCredential,
  type CredentialPayload,
} from "@/lib/adapters/credentials";
import { auditLog } from "@/lib/audit";
import { reportError } from "@/lib/monitoring";

type RouteParams = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await requireRole(["admin", "system_admin"]);

    const id = parseInt(params.id, 10);
    if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const orgId = getOrgId(user);
    const meta = await getCredentialMeta(id, orgId);
    if (!meta) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ credential: meta });
  } catch (err) {
    reportError(err, { context: `GET /api/admin/adapter-credentials/${params.id}` });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await requireRole(["admin", "system_admin"]);

    const id = parseInt(params.id, 10);
    if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await req.json();
    const { name, credentials: payload, isActive } = body as {
      name?: string;
      credentials?: CredentialPayload;
      isActive?: boolean;
    };

    if (name === undefined && payload === undefined && isActive === undefined) {
      return NextResponse.json(
        { error: "At least one of name, credentials, or isActive must be provided" },
        { status: 400 },
      );
    }

    const orgId = getOrgId(user);
    await updateCredential(id, orgId, { name, payload, isActive });

    await auditLog({
      actorEmail: user.email ?? "unknown",
      action: "adapter_credential.updated",
      entityType: "adapter_credentials",
      entityId: id,
      organizationId: orgId,
      metadata: { updatedFields: Object.keys(body) },
    });

    const meta = await getCredentialMeta(id, orgId);
    return NextResponse.json({ credential: meta });
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    reportError(err, { context: `PUT /api/admin/adapter-credentials/${params.id}` });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await requireRole(["admin", "system_admin"]);

    const id = parseInt(params.id, 10);
    if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const orgId = getOrgId(user);
    const deleted = await deleteCredential(id, orgId);
    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await auditLog({
      actorEmail: user.email ?? "unknown",
      action: "adapter_credential.deleted",
      entityType: "adapter_credentials",
      entityId: id,
      organizationId: orgId,
    });

    return NextResponse.json({ deleted: true });
  } catch (err) {
    reportError(err, { context: `DELETE /api/admin/adapter-credentials/${params.id}` });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
