/**
 * POST   /api/admin/adapter-credentials  — store a new credential set
 * GET    /api/admin/adapter-credentials  — list all (metadata only, no secrets)
 *
 * Access: admin, system_admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { getOrgId } from "@/lib/org-context";
import {
  storeCredential,
  listCredentials,
  type AdapterType,
  type CredentialPayload,
} from "@/lib/adapters/credentials";
import { auditLog } from "@/lib/audit";
import { reportError } from "@/lib/monitoring";

const VALID_ADAPTER_TYPES: AdapterType[] = [
  "sap_s4hana",
  "workday",
  "oracle_fusion",
  "servicenow",
];

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await requireRole(["admin", "system_admin"]);

    const orgId = getOrgId(user);
    const credentials = await listCredentials(orgId);
    return NextResponse.json({ credentials });
  } catch (err) {
    reportError(err, { context: "GET /api/admin/adapter-credentials" });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await requireRole(["admin", "system_admin"]);

    const body = await req.json();
    const { adapterType, name, credentials: payload } = body as {
      adapterType: string;
      name: string;
      credentials: CredentialPayload;
    };

    if (!adapterType || !name || !payload) {
      return NextResponse.json(
        { error: "adapterType, name, and credentials are required" },
        { status: 400 },
      );
    }

    if (!VALID_ADAPTER_TYPES.includes(adapterType as AdapterType)) {
      return NextResponse.json(
        { error: `Invalid adapterType. Must be one of: ${VALID_ADAPTER_TYPES.join(", ")}` },
        { status: 400 },
      );
    }

    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
    }

    if (typeof payload !== "object" || Array.isArray(payload)) {
      return NextResponse.json({ error: "credentials must be an object" }, { status: 400 });
    }

    const orgId = getOrgId(user);
    const id = await storeCredential(orgId, adapterType as AdapterType, name.trim(), payload);

    await auditLog({
      actorEmail: user.email ?? "unknown",
      action: "adapter_credential.created",
      entityType: "adapter_credentials",
      entityId: id,
      organizationId: orgId,
      metadata: { adapterType, name },
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    reportError(err, { context: "POST /api/admin/adapter-credentials" });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
