import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgTree, getAllOrgUnits } from "@/lib/org-hierarchy";
import { getSessionUser } from "@/lib/auth";
import { safeError } from "@/lib/errors";
import { getOrgId } from "@/lib/org-context";
import { auditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tree = await getOrgTree();

    // Also return flat list of app users with mapper/approver roles for assignment dropdowns
    const appUsers = await db
      .select({
        id: schema.appUsers.id,
        displayName: schema.appUsers.displayName,
        role: schema.appUsers.role,
      })
      .from(schema.appUsers)
      .where(eq(schema.appUsers.isActive, true));

    const mappers = appUsers.filter((u) => u.role === "mapper");
    const approvers = appUsers.filter((u) => u.role === "approver");
    const allUnits = await getAllOrgUnits();

    return NextResponse.json({ tree, mappers, approvers, allUnits });
  } catch (error) {
    return NextResponse.json(
      { error: safeError(error, "Failed to load org hierarchy") },
      { status: 500 }
    );
  }
}

// CREATE org unit
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== "system_admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const { name, level, parentId, description } = await req.json();

    if (!name || !level) {
      return NextResponse.json({ error: "name and level are required" }, { status: 400 });
    }

    if (!["L1", "L2", "L3"].includes(level)) {
      return NextResponse.json({ error: "level must be L1, L2, or L3" }, { status: 400 });
    }

    // Validate parent constraints
    if (level === "L1" && parentId) {
      return NextResponse.json({ error: "L1 units cannot have a parent" }, { status: 400 });
    }

    if (level === "L2") {
      if (!parentId) {
        return NextResponse.json({ error: "L2 units must have an L1 parent" }, { status: 400 });
      }
      const [parent] = await db.select().from(schema.orgUnits).where(eq(schema.orgUnits.id, parentId)).limit(1);
      if (!parent || parent.level !== "L1") {
        return NextResponse.json({ error: "L2 parent must be an L1 unit" }, { status: 400 });
      }
    }

    if (level === "L3") {
      if (!parentId) {
        return NextResponse.json({ error: "L3 units must have an L2 parent" }, { status: 400 });
      }
      const [parent] = await db.select().from(schema.orgUnits).where(eq(schema.orgUnits.id, parentId)).limit(1);
      if (!parent || parent.level !== "L2") {
        return NextResponse.json({ error: "L3 parent must be an L2 unit" }, { status: 400 });
      }
    }

    const [inserted] = await db
      .insert(schema.orgUnits)
      .values({
        organizationId: getOrgId(user),
        name,
        level,
        parentId: parentId || null,
        description: description || null,
      })
      .returning();

    // Audit log
    await auditLog({
      organizationId: getOrgId(user),
      entityType: "orgUnit",
      entityId: inserted.id,
      action: "created",
      newValue: JSON.stringify({ name, level, parentId, description }),
      actorEmail: user.email ?? user.username,
    });

    return NextResponse.json({ success: true, orgUnit: inserted });
  } catch (err: unknown) {
    const message = safeError(err, "Failed to create org unit");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// UPDATE org unit
export async function PUT(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== "system_admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const { id, name, description, parentId, assignedMapperId, assignedApproverId } = await req.json();

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const [existing] = await db.select().from(schema.orgUnits).where(eq(schema.orgUnits.id, id)).limit(1);
    if (!existing) {
      return NextResponse.json({ error: "Org unit not found" }, { status: 404 });
    }

    const oldValue = JSON.stringify(existing);

    // Validate parent reassignment if provided
    if (parentId !== undefined) {
      if (existing.level === "L1" && parentId) {
        return NextResponse.json({ error: "L1 units cannot have a parent" }, { status: 400 });
      }
      if (existing.level === "L2" && parentId) {
        const [parent] = await db.select().from(schema.orgUnits).where(eq(schema.orgUnits.id, parentId)).limit(1);
        if (!parent || parent.level !== "L1") {
          return NextResponse.json({ error: "L2 parent must be an L1 unit" }, { status: 400 });
        }
      }
      if (existing.level === "L3" && parentId) {
        const [parent] = await db.select().from(schema.orgUnits).where(eq(schema.orgUnits.id, parentId)).limit(1);
        if (!parent || parent.level !== "L2") {
          return NextResponse.json({ error: "L3 parent must be an L2 unit" }, { status: 400 });
        }
      }
      // Prevent self-parenting
      if (parentId === id) {
        return NextResponse.json({ error: "Cannot set unit as its own parent" }, { status: 400 });
      }
    }

    // Update org unit fields
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (parentId !== undefined) updates.parentId = parentId || null;

    if (Object.keys(updates).length > 0) {
      await db.update(schema.orgUnits).set(updates).where(eq(schema.orgUnits.id, id));
    }

    // Handle mapper assignment
    if (assignedMapperId !== undefined) {
      // Remove any existing mapper assignment for this org unit
      const existingMappers = await db
        .select()
        .from(schema.appUsers)
        .where(
          and(
            eq(schema.appUsers.assignedOrgUnitId, id),
            eq(schema.appUsers.role, "mapper")
          )
        );
      for (const m of existingMappers) {
        await db.update(schema.appUsers)
          .set({ assignedOrgUnitId: null })
          .where(eq(schema.appUsers.id, m.id));
      }

      // Assign new mapper if provided
      if (assignedMapperId) {
        await db.update(schema.appUsers)
          .set({ assignedOrgUnitId: id })
          .where(eq(schema.appUsers.id, assignedMapperId));
      }
    }

    // Handle approver assignment
    if (assignedApproverId !== undefined) {
      // Remove any existing approver assignment for this org unit
      const existingApprovers = await db
        .select()
        .from(schema.appUsers)
        .where(
          and(
            eq(schema.appUsers.assignedOrgUnitId, id),
            eq(schema.appUsers.role, "approver")
          )
        );
      for (const a of existingApprovers) {
        await db.update(schema.appUsers)
          .set({ assignedOrgUnitId: null })
          .where(eq(schema.appUsers.id, a.id));
      }

      // Assign new approver if provided
      if (assignedApproverId) {
        await db.update(schema.appUsers)
          .set({ assignedOrgUnitId: id })
          .where(eq(schema.appUsers.id, assignedApproverId));
      }
    }

    // Audit log
    await auditLog({
      organizationId: getOrgId(user),
      entityType: "orgUnit",
      entityId: id,
      action: "updated",
      oldValue,
      newValue: JSON.stringify({ name, description, parentId, assignedMapperId, assignedApproverId }),
      actorEmail: user.email ?? user.username,
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = safeError(err, "Failed to update org unit");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE org unit
export async function DELETE(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== "system_admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const { id } = await req.json();

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const [existing] = await db.select().from(schema.orgUnits).where(eq(schema.orgUnits.id, id)).limit(1);
    if (!existing) {
      return NextResponse.json({ error: "Org unit not found" }, { status: 404 });
    }

    // Check for children
    const children = await db
      .select()
      .from(schema.orgUnits)
      .where(eq(schema.orgUnits.parentId, id));
    if (children.length > 0) {
      return NextResponse.json(
        { error: "Cannot delete org unit that has children. Delete children first." },
        { status: 400 }
      );
    }

    // Check for assigned users (warning — still allow deletion)
    const assignedUsers = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.orgUnitId, id));

    // Unset assignedOrgUnitId for app users assigned to this org unit
    await db.update(schema.appUsers)
      .set({ assignedOrgUnitId: null })
      .where(eq(schema.appUsers.assignedOrgUnitId, id));

    // Unset orgUnitId for users assigned to this org unit
    await db.update(schema.users)
      .set({ orgUnitId: null })
      .where(eq(schema.users.orgUnitId, id));

    // Delete
    await db.delete(schema.orgUnits).where(eq(schema.orgUnits.id, id));

    // Audit log
    await auditLog({
      organizationId: getOrgId(user),
      entityType: "orgUnit",
      entityId: id,
      action: "deleted",
      oldValue: JSON.stringify(existing),
      actorEmail: user.email ?? user.username,
    });

    return NextResponse.json({
      success: true,
      warning: assignedUsers.length > 0
        ? `${assignedUsers.length} users were unassigned from this org unit.`
        : undefined,
    });
  } catch (err: unknown) {
    const message = safeError(err, "Failed to delete org unit");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
