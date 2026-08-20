import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { parse } from "csv-parse/sync";
import { readFileSync, existsSync } from "fs";
import { eq, and, sql } from "drizzle-orm";
import path from "path";
import { createClient } from "@supabase/supabase-js";

/**
 * Helper to create a Supabase Auth user via admin API.
 * Returns the auth user ID, or null if Supabase env vars are not configured.
 */
async function createSupabaseAuthUser(
  email: string,
  password: string
): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    // Supabase Auth not configured — skip auth user creation
    return null;
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Check if user already exists with this email
  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  const existing = existingUsers?.users?.find((u) => u.email === email);
  if (existing) {
    // Update password and return existing ID
    await supabase.auth.admin.updateUserById(existing.id, { password });
    return existing.id;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    console.warn(`  ⚠ Failed to create Supabase Auth user for ${email}: ${error.message}`);
    return null;
  }

  return data.user?.id ?? null;
}

const DATA_DIR = path.join(process.cwd(), "data");

/**
 * Exported for API-based demo reset (called from /api/demo endpoints).
 * Pass in the shared db instance and pack name.
 */
export async function seedDatabase(seedDb: ReturnType<typeof drizzle<typeof schema>>, seedPackName: string): Promise<void> {
  const seedCsvDir = path.join(DATA_DIR, "demos", seedPackName);
  console.log(`[seed] DATA_DIR=${DATA_DIR}, seedCsvDir=${seedCsvDir}, exists=${existsSync(seedCsvDir)}`);
  if (!existsSync(seedCsvDir)) {
    throw new Error(`Demo pack not found: ${seedCsvDir}`);
  }

  function readPackCsv<T>(filename: string): T[] {
    const filepath = path.join(seedCsvDir, filename);
    if (!existsSync(filepath)) return [];
    const content = readFileSync(filepath, "utf-8");
    return parse(content, { columns: true, skip_empty_lines: true, trim: true }) as T[];
  }

  await runSeed(seedDb, readPackCsv);
}

async function runSeed(db: ReturnType<typeof drizzle>, readCsvFn: <T>(f: string) => T[]) {
  console.log("🌱 Seeding database...\n");

  // ─── Ensure default organization exists ───
  await db.insert(schema.organizations).values({
    name: "Demo Organization",
    slug: "demo",
    description: "Default organization for the demo instance",
    isActive: true,
  }).onConflictDoNothing();
  console.log("  ✓ Default organization");

  // ─── Ensure reserved system organization exists (id=0) ───
  // Used as the tenant for platform-level incidents. See lib/incidents/detection.ts (SYSTEM_ORG_ID).
  await db.execute(sql`
    INSERT INTO public.organizations (id, name, slug, is_active, created_at, updated_at)
    VALUES (0, '__system__', 'system', true, now()::text, now()::text)
    ON CONFLICT (id) DO NOTHING
  `);
  console.log("  ✓ System organization (id=0)");

  // ─── Clear all data tables via TRUNCATE CASCADE ───
  // Using raw SQL TRUNCATE ... CASCADE avoids FK ordering issues entirely.
  // We preserve `organizations` and `demo_leads` (not part of seed data).
  await db.execute(sql`TRUNCATE TABLE
    user_gap_reviews, mapping_feedback, security_work_items, evidence_package_runs, incidents,
    chat_conversations, scheduled_exports, webhook_deliveries, webhook_endpoints,
    persona_confirmations, review_links, notifications, user_invites,
    rate_limit_entries, security_design_changes, workstream_items, release_org_units,
    audit_log, processing_jobs, permission_gaps, sod_conflicts, sod_rules,
    user_target_role_assignments, persona_target_role_mappings, user_persona_assignments,
    persona_source_permissions, user_source_role_assignments, source_role_permissions,
    target_security_role_tasks, target_task_role_permissions, target_role_permissions,
    target_task_roles, least_access_exceptions, personas, consolidated_groups,
    source_permissions, source_roles, target_permissions, target_roles,
    users, org_units, release_users, release_source_roles, release_target_roles,
    release_sod_rules, app_user_releases, releases, feature_flags, system_settings,
    work_assignments, app_user_sessions, app_users, sso_configurations
    CASCADE
  `);

  // ─── 0. Org Hierarchy ───
  const orgHierarchy: { name: string; level: string; parentName?: string; description?: string }[] = [
    // L1
    { name: "Operations", level: "L1", description: "Core operational functions" },
    { name: "Corporate Services", level: "L1", description: "Corporate support functions" },
    { name: "Technology", level: "L1", description: "Technology and engineering" },
    // L2 under Operations
    { name: "Maintenance", level: "L2", parentName: "Operations", description: "Asset maintenance and reliability" },
    { name: "Facilities", level: "L2", parentName: "Operations", description: "Facilities management" },
    { name: "Supply Chain", level: "L2", parentName: "Operations", description: "Supply chain and logistics" },
    { name: "Warehouse", level: "L2", parentName: "Operations", description: "Warehouse and inventory management" },
    { name: "Quality", level: "L2", parentName: "Operations", description: "Quality assurance and control" },
    // L2 under Corporate Services
    { name: "Finance", level: "L2", parentName: "Corporate Services", description: "Financial management and reporting" },
    { name: "Procurement", level: "L2", parentName: "Corporate Services", description: "Procurement and vendor management" },
    { name: "Market Research", level: "L2", parentName: "Corporate Services", description: "Market research and analysis" },
    // L2 under Technology
    { name: "Product Development", level: "L2", parentName: "Technology", description: "Product development and engineering" },
    { name: "Product", level: "L2", parentName: "Technology", description: "Product management" },
    { name: "Research & Development", level: "L2", parentName: "Technology", description: "Research and development" },
    // L3 under Maintenance
    { name: "Rotating Equipment", level: "L3", parentName: "Maintenance", description: "Rotating equipment maintenance" },
    { name: "Instrumentation", level: "L3", parentName: "Maintenance", description: "Instrumentation and controls" },
    { name: "Electrical", level: "L3", parentName: "Maintenance", description: "Electrical systems maintenance" },
    { name: "Civil", level: "L3", parentName: "Maintenance", description: "Civil and structural maintenance" },
    // L3 under Finance
    { name: "Accounts Payable", level: "L3", parentName: "Finance", description: "Accounts payable processing" },
    { name: "Accounts Receivable", level: "L3", parentName: "Finance", description: "Accounts receivable and collections" },
    { name: "General Ledger", level: "L3", parentName: "Finance", description: "General ledger and financial reporting" },
    { name: "Treasury", level: "L3", parentName: "Finance", description: "Treasury and cash management" },
    // L3 under Supply Chain
    { name: "Logistics", level: "L3", parentName: "Supply Chain", description: "Transportation and logistics" },
    { name: "Demand Planning", level: "L3", parentName: "Supply Chain", description: "Demand forecasting and planning" },
    { name: "Distribution", level: "L3", parentName: "Supply Chain", description: "Distribution operations" },
    // L3 under Warehouse
    { name: "Receiving", level: "L3", parentName: "Warehouse", description: "Goods receiving" },
    { name: "Inventory Control", level: "L3", parentName: "Warehouse", description: "Inventory control and counting" },
    // L3 under Procurement
    { name: "Strategic Sourcing", level: "L3", parentName: "Procurement", description: "Strategic sourcing and contracts" },
    { name: "Vendor Management", level: "L3", parentName: "Procurement", description: "Vendor onboarding and management" },
    // L3 under Product Development
    { name: "Design Engineering", level: "L3", parentName: "Product Development", description: "Product design and engineering" },
    { name: "Testing", level: "L3", parentName: "Product Development", description: "Testing and validation" },
  ];

  // Insert L1 first, then L2, then L3 to respect parent ordering
  const orgUnitIdMap = new Map<string, number>();
  for (const level of ["L1", "L2", "L3"]) {
    for (const ou of orgHierarchy.filter(o => o.level === level)) {
      const parentId = ou.parentName ? orgUnitIdMap.get(ou.parentName) ?? null : null;
      const [result] = await db.insert(schema.orgUnits).values({
        organizationId: 1,
        name: ou.name,
        level: ou.level,
        parentId,
        description: ou.description,
      }).returning({ id: schema.orgUnits.id });
      orgUnitIdMap.set(ou.name, result.id);
    }
  }
  console.log(`  ✓ ${orgHierarchy.length} org units (L1/L2/L3 hierarchy)`);

  // ─── Department → OrgUnit mapping (L2 departments match directly) ───
  const deptToOrgUnit = new Map<string, number>();
  orgUnitIdMap.forEach((id, name) => {
    deptToOrgUnit.set(name, id);
  });

  // ─── 1. Users ───
  const BATCH_SIZE = 500;
  const usersData = readCsvFn<any>("users.csv");
  for (let i = 0; i < usersData.length; i += BATCH_SIZE) {
    const batch = usersData.slice(i, i + BATCH_SIZE);
    for (const row of batch) {
      const dept = row.department?.trim();
      const ouId = dept ? (deptToOrgUnit.get(dept) ?? null) : null;
      await db.insert(schema.users).values({
        organizationId: 1,
        sourceUserId: row.source_user_id,
        displayName: row.display_name,
        email: row.email,
        jobTitle: row.job_title,
        department: row.department,
        orgUnitId: ouId,
      });
    }
    if (usersData.length > 1000 && i + BATCH_SIZE < usersData.length) {
      process.stdout.write(`\r  ⏳ Users: ${Math.min(i + BATCH_SIZE, usersData.length)}/${usersData.length}`);
    }
  }
  if (usersData.length > 1000) process.stdout.write("\r");
  console.log(`  ✓ ${usersData.length} users`);

  // ─── 2. Consolidated Groups (skip if file not in demo pack) ───
  const groupsData = readCsvFn<any>("consolidated-groups.csv");
  if (groupsData.length > 0) {
    for (const row of groupsData) {
      await db.insert(schema.consolidatedGroups).values({
        organizationId: 1,
        name: row.name,
        accessLevel: row.access_level,
        description: row.description,
      });
    }
    console.log(`  ✓ ${groupsData.length} consolidated groups`);
  } else {
    console.log("  ⊘ consolidated-groups.csv not found or empty, skipping (personas not pre-loaded for this pack)");
  }

  // ─── 3. Personas (skip if file not in demo pack) ───
  const personasData = readCsvFn<any>("personas.csv");
  if (personasData.length > 0) {
    for (const row of personasData) {
      await db.insert(schema.personas).values({
        organizationId: 1,
        name: row.name,
        description: row.description,
        businessFunction: row.business_function,
        source: "ai",
      });
    }
    console.log(`  ✓ ${personasData.length} personas`);
  } else {
    console.log("  ⊘ personas.csv not found or empty, skipping (generate personas via Jobs page)");
  }

  // ─── 4. Persona → Group Mappings (skip if file not in demo pack) ───
  const pgMappings = readCsvFn<any>("persona-group-mappings.csv");
  let pgCount = 0;
  if (pgMappings.length > 0) {
    for (const row of pgMappings) {
      const [group] = await db.select().from(schema.consolidatedGroups)
        .where(eq(schema.consolidatedGroups.name, row.consolidated_group_name));
      if (group) {
        await db.update(schema.personas)
          .set({ consolidatedGroupId: group.id })
          .where(eq(schema.personas.name, row.persona_name));
        pgCount++;
      }
    }
    console.log(`  ✓ ${pgCount} persona-group mappings`);
  } else {
    console.log("  ⊘ persona-group-mappings.csv not found or empty, skipping");
  }

  // ─── 5. Source Roles ───
  const rolesData = readCsvFn<any>("source-roles.csv");
  for (const row of rolesData) {
    await db.insert(schema.sourceRoles).values({
      organizationId: 1,
      roleId: row.role_id,
      roleName: row.role_name,
      description: row.description,
      system: row.system || "SAP ECC",
      domain: row.domain,
      roleOwner: row.role_owner || null,
    });
  }
  console.log(`  ✓ ${rolesData.length} source roles`);

  // ─── 6. Source Permissions ───
  const permData = readCsvFn<any>("source-permissions.csv");
  for (const row of permData) {
    await db.insert(schema.sourcePermissions).values({
      permissionId: row.permission_id,
      permissionName: row.permission_name || null,
      description: row.description || null,
      system: row.system || "SAP ECC",
      riskLevel: row.risk_level || null,
    });
  }
  console.log(`  ✓ ${permData.length} source permissions`);

  // ─── 7. Source Role-Permission Assignments ───
  const rpData = readCsvFn<any>("source-role-permissions.csv");
  let rpCount = 0;
  for (const row of rpData) {
    const [role] = await db.select().from(schema.sourceRoles)
      .where(eq(schema.sourceRoles.roleId, row.role_id));
    const [perm] = await db.select().from(schema.sourcePermissions)
      .where(eq(schema.sourcePermissions.permissionId, row.permission_id));
    if (role && perm) {
      await db.insert(schema.sourceRolePermissions).values({
        sourceRoleId: role.id,
        sourcePermissionId: perm.id,
      });
      rpCount++;
    }
  }
  console.log(`  ✓ ${rpCount} role-permission assignments`);

  // ─── 8. Target Roles ───
  const targetRolesData = readCsvFn<any>("target-roles.csv");
  for (const row of targetRolesData) {
    if (row.role_id === "Role ID") continue; // skip header row if duplicated
    await db.insert(schema.targetRoles).values({
      organizationId: 1,
      roleId: row.role_id,
      roleName: row.role_name,
      description: row.description,
      system: row.system || "S/4HANA",
      domain: row.domain || "Finance",
      roleOwner: row.role_owner || null,
    });
  }
  console.log(`  ✓ ${targetRolesData.length} target roles`);

  // ─── 9. Target Permissions (optional) ───
  const targetPermData = readCsvFn<any>("target-permissions.csv");
  if (targetPermData.length > 0) {
    for (const row of targetPermData) {
      await db.insert(schema.targetPermissions).values({
        permissionId: row.permission_id,
        permissionName: row.permission_name || null,
        description: row.description || null,
        system: row.system || "S/4HANA",
        riskLevel: row.risk_level || null,
      });
    }
    console.log(`  ✓ ${targetPermData.length} target permissions`);
  } else {
    console.log("  ⊘ target-permissions.csv not found or empty, skipping");
  }

  // ─── 9b. Target Role-Permission Assignments ───
  const trpData = readCsvFn<any>("target-role-permissions.csv");
  let trpCount = 0;
  for (const row of trpData) {
    const [role] = await db.select().from(schema.targetRoles)
      .where(eq(schema.targetRoles.roleId, row.target_role_id));
    const [perm] = await db.select().from(schema.targetPermissions)
      .where(eq(schema.targetPermissions.permissionId, row.permission_id));
    if (role && perm) {
      await db.insert(schema.targetRolePermissions).values({
        targetRoleId: role.id,
        targetPermissionId: perm.id,
      });
      trpCount++;
    }
  }
  if (trpCount > 0) {
    console.log(`  ✓ ${trpCount} target role-permission assignments`);
  } else {
    console.log("  ⊘ target-role-permissions.csv not found or empty, skipping");
  }

  // ─── 10. User-Persona Assignments (skip if file not in demo pack) ───
  const upaData = readCsvFn<any>("user-persona-assignments.csv");
  let upaCount = 0;
  if (upaData.length > 0) {
    for (const row of upaData) {
      const [user] = await db.select().from(schema.users)
        .where(eq(schema.users.sourceUserId, row.source_user_id));
      const [persona] = await db.select().from(schema.personas)
        .where(eq(schema.personas.name, row.persona_name));
      if (user && persona) {
        await db.insert(schema.userPersonaAssignments).values({
          userId: user.id,
          personaId: persona.id,
          consolidatedGroupId: persona.consolidatedGroupId,
          confidenceScore: parseFloat(row.confidence_score) || null,
          assignmentMethod: row.assignment_method || "ai",
        });
        upaCount++;
      }
    }
    console.log(`  ✓ ${upaCount} user-persona assignments`);
  } else {
    console.log("  ⊘ user-persona-assignments.csv not found or empty, skipping (generate personas first)");
  }

  // ─── 10b. User-Source Role Assignments (optional) ───
  const usraData = readCsvFn<any>("user-source-role-assignments.csv");
  let usraCount = 0;
  for (const row of usraData) {
    const [user] = await db.select().from(schema.users)
      .where(eq(schema.users.sourceUserId, row.user_id));
    const [role] = await db.select().from(schema.sourceRoles)
      .where(eq(schema.sourceRoles.roleId, row.role_id));
    if (user && role) {
      await db.insert(schema.userSourceRoleAssignments).values({
        userId: user.id,
        sourceRoleId: role.id,
      });
      usraCount++;
    }
  }
  if (usraCount > 0) {
    console.log(`  ✓ ${usraCount} user-source role assignments`);
  } else {
    console.log("  ⊘ user-source-role-assignments.csv not found or empty, skipping");
  }

  // ─── 11. SOD Rules (optional) ───
  const sodData = readCsvFn<any>("sod-rules.csv");
  if (sodData.length > 0) {
    for (const row of sodData) {
      await db.insert(schema.sodRules).values({
        organizationId: 1,
        ruleId: row.rule_id,
        ruleName: row.rule_name,
        description: row.description || null,
        permissionA: row.permission_a,
        permissionB: row.permission_b,
        severity: row.severity || "medium",
        riskDescription: row.risk_description || null,
      });
    }
    console.log(`  ✓ ${sodData.length} SOD rules`);
  } else {
    console.log("  ⊘ sod-rules.csv not found or empty, skipping");
  }

  // ─── 11c. User-Target-Role Assignments (loaded from CSV) ───
  // Lookup helpers
  const targetRoleLookup = new Map<string, number>();
  const allTargetRoles = await db.select().from(schema.targetRoles);
  for (const tr of allTargetRoles) {
    targetRoleLookup.set(tr.roleId, tr.id);
  }

  const userLookup = new Map<string, { id: number; department: string | null }>();
  const allUsers = await db.select().from(schema.users);
  for (const u of allUsers) {
    userLookup.set(u.sourceUserId, { id: u.id, department: u.department });
  }

  const utraData = readCsvFn<any>("user-target-role-assignments.csv");
  let utraCount = 0;
  for (const row of utraData) {
    const userInfo = userLookup.get(row.user_id);
    const targetRoleDbId = targetRoleLookup.get(row.role_id);
    if (userInfo && targetRoleDbId) {
      const phase = row.release_phase?.trim() || "current";
      const isExisting = phase === "existing";
      await db.insert(schema.userTargetRoleAssignments).values({
        userId: userInfo.id,
        targetRoleId: targetRoleDbId,
        assignmentType: isExisting ? "existing_access" : "seed_demo",
        status: isExisting ? "approved" : "draft",
        releasePhase: phase,
      });
      utraCount++;
    }
  }
  if (utraCount > 0) {
    console.log(`  ✓ ${utraCount} user-target-role assignments (loaded from CSV)`);
  } else {
    console.log("  ⊘ user-target-role-assignments.csv not found or empty, skipping");
  }

  // ─── 11d. Run SOD analysis on seeded assignments ───
  const [isSapCheck] = await db.select().from(schema.targetPermissions)
    .where(eq(schema.targetPermissions.permissionId, "F0717"));
  const isSapPack = isSapCheck !== undefined;

  const targetSodRules: { ruleId: string; ruleName: string; permA: string; permB: string; severity: string; riskDesc: string }[] = !isSapPack ? [] : [
    { ruleId: "T-SOD-AP-001", ruleName: "Create & Approve Invoice", permA: "F0717", permB: "F0859",
      severity: "critical", riskDesc: "A user who can both create supplier invoices (F0717) and approve them (F0859) can post fraudulent invoices and approve their own entries, bypassing the dual-control requirement for accounts payable." },
    { ruleId: "T-SOD-AP-002", ruleName: "Invoice Entry & Payment Execution", permA: "F0717", permB: "F1603",
      severity: "critical", riskDesc: "A user who can post supplier invoices and execute automatic payments has end-to-end control over cash disbursement. This allows posting fraudulent invoices and immediately paying them." },
    { ruleId: "T-SOD-AP-003", ruleName: "Vendor Master & Payment Execution", permA: "F0790", permB: "F1603",
      severity: "critical", riskDesc: "A user who can create/modify vendor master records and execute payment runs can create fictitious vendors and immediately pay them. This is one of the highest-risk SOD conflicts." },
    { ruleId: "T-SOD-AP-004", ruleName: "Vendor Master & Invoice Entry", permA: "F0790", permB: "F0717",
      severity: "high", riskDesc: "A user who can maintain vendor master data and post invoices can create fictitious vendors and record fraudulent invoices without a purchase order control point." },
    { ruleId: "T-SOD-AP-005", ruleName: "Invoice Approval & Payment Execution", permA: "F0859", permB: "F1603",
      severity: "high", riskDesc: "A user who can approve invoices and run payment programs controls both the approval gate and cash disbursement, weakening the procure-to-pay control framework." },
    { ruleId: "T-SOD-GL-001", ruleName: "GL Posting & Invoice Processing", permA: "F0400", permB: "F0717",
      severity: "high", riskDesc: "A user who can post journal entries and process invoices can manipulate both the sub-ledger and general ledger, making it difficult to detect financial statement fraud." },
    { ruleId: "T-SOD-GL-002", ruleName: "GL Posting & Payment Execution", permA: "F0400", permB: "F1603",
      severity: "high", riskDesc: "A user who can post journal entries and execute payments can create manual adjustments to cover fraudulent payment activity." },
    { ruleId: "T-SOD-AP-006", ruleName: "Vendor Master & Invoice Approval", permA: "F0790", permB: "F0859",
      severity: "high", riskDesc: "A user who can maintain vendor master records and approve invoices can modify vendor bank details and then approve invoices that route payments to unauthorized accounts." },
    { ruleId: "T-SOD-MM-001", ruleName: "Purchase Order & Goods Receipt", permA: "F2439", permB: "F3002",
      severity: "critical", riskDesc: "A user who can create purchase orders and post goods receipts can fabricate procurement commitments and falsely confirm delivery. This is among the most significant procurement SOD conflicts." },
    { ruleId: "T-SOD-MM-002", ruleName: "Create & Release Purchase Order", permA: "F2439", permB: "F2441",
      severity: "high", riskDesc: "A user who can create and approve purchase orders circumvents the purchasing authorization control. This is a foundational procurement segregation requirement." },
    { ruleId: "T-SOD-MM-003", ruleName: "Purchase Order & Inventory Adjustment", permA: "F2439", permB: "F3737",
      severity: "high", riskDesc: "A user who can create purchase orders and manage physical inventory can manipulate both procurement records and inventory counts to conceal misappropriation." },
    { ruleId: "T-SOD-MM-004", ruleName: "Goods Receipt & Inventory Differences", permA: "F3002", permB: "F3738",
      severity: "high", riskDesc: "A user who can post goods receipts and adjust inventory differences can inflate delivery quantities and then write off the discrepancies, concealing theft." },
    { ruleId: "T-SOD-MM-005", ruleName: "Purchase Order & Material Master", permA: "F2439", permB: "F3814",
      severity: "medium", riskDesc: "A user who can create purchase orders and maintain material master records controls both what can be procured and the actual procurement transaction." },
    { ruleId: "T-SOD-PM-001", ruleName: "Create & Confirm Maintenance Order", permA: "F4580", permB: "F4583",
      severity: "medium", riskDesc: "A user who can create maintenance orders and confirm their completion can report false work completion, enabling labor fraud and false productivity reporting." },
    { ruleId: "T-SOD-PM-002", ruleName: "Equipment Master & Maintenance Order", permA: "F4590", permB: "F4580",
      severity: "medium", riskDesc: "A user who can manage equipment records and create maintenance orders bypasses independent technical review of asset setup before work is authorized." },
    { ruleId: "T-SOD-PM-003", ruleName: "Schedule Plans & Confirm Order", permA: "F4600", permB: "F4583",
      severity: "medium", riskDesc: "A user who can schedule preventive maintenance and confirm its completion can falsify preventive maintenance records without independent verification." },
    { ruleId: "T-SOD-XM-001", ruleName: "Maintenance Order & Goods Receipt", permA: "F4580", permB: "F3002",
      severity: "high", riskDesc: "A user who can create maintenance orders and receive goods can authorize work and receive materials without independent oversight, enabling material diversion." },
    { ruleId: "T-SOD-XM-002", ruleName: "Maintenance Order & Purchase Order", permA: "F4581", permB: "F2439",
      severity: "high", riskDesc: "A user who can manage maintenance orders and create purchase orders controls both the work scope and procurement commitment, enabling inflated maintenance costs." },
    { ruleId: "T-SOD-XM-003", ruleName: "Equipment Master & Material Master", permA: "F4590", permB: "F3814",
      severity: "medium", riskDesc: "A user who can manage both equipment and material master records controls the registration of assets and their associated spare parts without separation between technical and procurement master data." },
    { ruleId: "T-SOD-WH-001", ruleName: "Goods Receipt & Goods Issue", permA: "F3002", permB: "F3003",
      severity: "medium", riskDesc: "A user who can process both goods receipts and goods issues can manipulate inventory levels without independent confirmation of inbound and outbound material flows." },
    { ruleId: "T-SOD-INV-001", ruleName: "Physical Inventory & Post Differences", permA: "F3737", permB: "F3738",
      severity: "critical", riskDesc: "A user who can conduct physical inventory counts and post the resulting adjustments has full control over inventory variance recognition, enabling concealment of theft." },
    { ruleId: "T-SOD-GL-003", ruleName: "GL Posting & Supplier Invoices", permA: "F0716", permB: "F0717",
      severity: "high", riskDesc: "A user who can post journal entries and process supplier invoices can manipulate both the sub-ledger and general ledger, making it difficult to detect financial statement fraud." },
    { ruleId: "T-SOD-MM-006", ruleName: "Purchase Order & Goods Receipt", permA: "F1074", permB: "F2093",
      severity: "high", riskDesc: "A user who can create purchase orders and post goods receipts can fabricate procurement transactions and falsely confirm delivery without independent oversight." },
    { ruleId: "T-SOD-WH-002", ruleName: "Goods Receipt & Goods Issue", permA: "F2093", permB: "F2094",
      severity: "medium", riskDesc: "A user who can process both goods receipts and goods issues can manipulate inventory levels without independent confirmation of inbound and outbound material flows." },
    { ruleId: "T-SOD-HR-001", ruleName: "Employee Data & Payroll Execution", permA: "F2721", permB: "F2722",
      severity: "critical", riskDesc: "A user who maintains employee records and runs payroll can create ghost employees and inflate payroll, representing one of the highest-risk HR SOD conflicts." },
    { ruleId: "T-SOD-IT-001", ruleName: "User Admin & Authorization Admin", permA: "F7721", permB: "F7722",
      severity: "critical", riskDesc: "A user who can create user accounts and configure authorization roles can grant themselves unlimited access to any system function, bypassing all other controls." },
    { ruleId: "T-SOD-PM-004", ruleName: "Create & Confirm Maintenance", permA: "F0893", permB: "F0894",
      severity: "medium", riskDesc: "A user who can create maintenance work orders and confirm their completion can fabricate maintenance activity, enabling labor fraud and false productivity reporting." },
    { ruleId: "T-SOD-MM-007", ruleName: "PO Approval & Supplier Master", permA: "F1076", permB: "F0743",
      severity: "high", riskDesc: "A user who can approve purchase orders and maintain supplier master data can set up preferred vendors and approve their own procurement transactions." },
    { ruleId: "T-SOD-GL-004", ruleName: "Document Reversal & Account Clearing", permA: "F0719", permB: "F0720",
      severity: "medium", riskDesc: "A user who can reverse documents and clear accounts can manipulate financial records by reversing and re-clearing entries to hide discrepancies." },
    { ruleId: "T-SOD-TR-001", ruleName: "Automatic Payments & Customer Payments", permA: "F2424", permB: "F2625",
      severity: "high", riskDesc: "A user who controls both outgoing automatic payments and incoming customer payment processing can divert funds by manipulating payment flows in both directions." },
    { ruleId: "T-SOD-CO-001", ruleName: "Cost Center Maintenance & Financial Reporting", permA: "F2872", permB: "F2312",
      severity: "low", riskDesc: "A user who maintains cost center master data and generates financial reports can manipulate cost allocations and then generate reports that conceal the misallocation." },
  ];

  // Insert target-system SOD rules
  for (const r of targetSodRules) {
    await db.insert(schema.sodRules).values({
      organizationId: 1,
      ruleId: r.ruleId,
      ruleName: r.ruleName,
      permissionA: r.permA,
      permissionB: r.permB,
      severity: r.severity,
      riskDescription: r.riskDesc,
    });
  }
  if (targetSodRules.length > 0) {
    console.log(`  ✓ ${targetSodRules.length} target-system SOD rules (S/4HANA Fiori permissions)`);
  } else {
    console.log("  ⊘ Skipped hardcoded S/4HANA SOD rules (non-SAP pack — SOD rules loaded from CSV)");
  }

  // Build permission map for target roles
  const seedRolePerms = new Map<number, Set<string>>();
  const seedTrps = await db.select({
    roleId: schema.targetRolePermissions.targetRoleId,
    permId: schema.targetPermissions.permissionId,
  }).from(schema.targetRolePermissions)
    .innerJoin(schema.targetPermissions, eq(schema.targetRolePermissions.targetPermissionId, schema.targetPermissions.id));
  for (const row of seedTrps) {
    if (!seedRolePerms.has(row.roleId)) seedRolePerms.set(row.roleId, new Set());
    seedRolePerms.get(row.roleId)!.add(row.permId);
  }

  // Load target permission name lookup
  const permNameLookup = new Map<string, string | null>();
  const allTargetPerms = await db.select().from(schema.targetPermissions);
  for (const tp of allTargetPerms) {
    permNameLookup.set(tp.permissionId, tp.permissionName);
  }

  // Load target role name lookup
  const roleNameLookup = new Map<number, string>();
  for (const tr of allTargetRoles) {
    roleNameLookup.set(tr.id, tr.roleName);
  }

  // Load all active SOD rules (including the target-system ones we just inserted)
  const activeRules = await db.select().from(schema.sodRules).where(eq(schema.sodRules.isActive, true));

  // Promote draft assignments to pending_review before SOD analysis
  await db.update(schema.userTargetRoleAssignments)
    .set({ status: "pending_review", updatedAt: new Date().toISOString() })
    .where(eq(schema.userTargetRoleAssignments.status, "draft"));

  // Group assignments by user — include both pending_review (current) and existing (previous wave) for SOD
  const seedAssignments = await db.select().from(schema.userTargetRoleAssignments)
    .where(eq(schema.userTargetRoleAssignments.status, "pending_review"));
  const seedExistingAssignments = await db.select().from(schema.userTargetRoleAssignments)
    .where(eq(schema.userTargetRoleAssignments.releasePhase, "existing"));

  const seedUserAssignments = new Map<number, number[]>(); // draft only
  const seedUserAllRoles = new Map<number, Set<number>>(); // all roles for SOD

  for (const a of seedAssignments) {
    if (!seedUserAssignments.has(a.userId)) seedUserAssignments.set(a.userId, []);
    seedUserAssignments.get(a.userId)!.push(a.targetRoleId);
    if (!seedUserAllRoles.has(a.userId)) seedUserAllRoles.set(a.userId, new Set());
    seedUserAllRoles.get(a.userId)!.add(a.targetRoleId);
  }
  for (const a of seedExistingAssignments) {
    if (!seedUserAllRoles.has(a.userId)) seedUserAllRoles.set(a.userId, new Set());
    seedUserAllRoles.get(a.userId)!.add(a.targetRoleId);
  }

  let seedConflictsFound = 0;
  const seedUsersWithConflicts = new Set<number>();

  const seedUserEntries = Array.from(seedUserAssignments.entries());
  for (const [userId, draftRoleIds] of seedUserEntries) {
    const allRoleIds = Array.from(seedUserAllRoles.get(userId) || new Set<number>());
    const userPerms = new Set<string>();
    const permToRole = new Map<string, number>();
    for (const roleId of allRoleIds) {
      const perms = seedRolePerms.get(roleId) || new Set();
      const permArr = Array.from(perms);
      for (const p of permArr) {
        userPerms.add(p);
        permToRole.set(p, roleId);
      }
    }

    let userConflictCount = 0;
    for (const rule of activeRules) {
      if (userPerms.has(rule.permissionA) && userPerms.has(rule.permissionB)) {
        seedConflictsFound++;
        userConflictCount++;
        seedUsersWithConflicts.add(userId);

        const roleIdA = permToRole.get(rule.permissionA) ?? null;
        const roleIdB = permToRole.get(rule.permissionB) ?? null;
        const roleAName = roleIdA ? (roleNameLookup.get(roleIdA) ?? null) : null;
        const roleBName = roleIdB ? (roleNameLookup.get(roleIdB) ?? null) : null;
        const permAName = permNameLookup.get(rule.permissionA) ?? null;
        const permBName = permNameLookup.get(rule.permissionB) ?? null;

        const conflictType = (roleIdA !== null && roleIdB !== null && roleIdA === roleIdB)
          ? "within_role"
          : "between_role";

        const risk = rule.riskDescription
          ? rule.riskDescription
          : `Conflicting access: "${permAName ?? rule.permissionA}" and "${permBName ?? rule.permissionB}" should be held by separate individuals.`;
        let resolution: string;
        if (conflictType === "within_role") {
          resolution = `This is a within-role conflict: the role "${roleAName ?? "this role"}" contains both conflicting permissions. This role needs to be reviewed and potentially split by the Security/GRC team.`;
        } else {
          resolution = rule.severity === "critical"
            ? `Resolution required: Remove "${roleAName ?? "one role"}" or "${roleBName ?? "the other role"}". Risk acceptance is NOT permitted for critical conflicts.`
            : `Resolution options: Remove "${roleAName ?? "one role"}" or "${roleBName ?? "the other role"}", or submit a risk acceptance request with business justification.`;
        }
        const riskExplanation = `${risk}\n\n${resolution}`;

        await db.insert(schema.sodConflicts).values({
          userId,
          sodRuleId: rule.id,
          roleIdA,
          roleIdB,
          permissionIdA: rule.permissionA,
          permissionIdB: rule.permissionB,
          severity: rule.severity,
          conflictType,
          resolutionStatus: "open",
          riskExplanation,
        });
      }
    }

    // Update assignment statuses for DRAFT assignments only
    const newStatus = userConflictCount > 0 ? "sod_rejected" : "compliance_approved";
    for (const roleId of draftRoleIds) {
      await db.update(schema.userTargetRoleAssignments).set({
        status: newStatus,
        sodConflictCount: userConflictCount,
        updatedAt: new Date().toISOString(),
      }).where(
        and(
          eq(schema.userTargetRoleAssignments.userId, userId),
          eq(schema.userTargetRoleAssignments.targetRoleId, roleId),
          eq(schema.userTargetRoleAssignments.status, "pending_review"),
        )
      );
    }
  }

  console.log(`  ✓ ${seedConflictsFound} SOD conflicts detected across ${seedUsersWithConflicts.size} users`);
  console.log(`    (${seedUserAssignments.size - seedUsersWithConflicts.size} users clean, ${seedUsersWithConflicts.size} users with conflicts)`);

  // ─── 12. Default Admin User ───
  // (app_users already cleared by TRUNCATE CASCADE above)

  const testUsers = [
    { username: "sysadmin", displayName: "System Administrator", role: "system_admin", password: "Sysadmin@2026!", orgUnit: null as string | null },
    { username: "admin", displayName: "Administrator", role: "admin", password: "AdminPass@2026!", orgUnit: null as string | null },
    { username: "mapper.finance", displayName: "Jane Chen (Finance Mapper)", role: "mapper", password: "Provisum@2026!", orgUnit: "Finance" },
    { username: "mapper.maintenance", displayName: "Mike Torres (Maintenance Mapper)", role: "mapper", password: "Provisum@2026!", orgUnit: "Maintenance" },
    { username: "mapper.procurement", displayName: "Sarah Kim (Procurement Mapper)", role: "mapper", password: "Provisum@2026!", orgUnit: "Procurement" },
    { username: "approver.finance", displayName: "David Okafor (Finance Approver)", role: "approver", password: "Provisum@2026!", orgUnit: "Corporate Services" },
    { username: "approver.operations", displayName: "Lisa Park (Operations Approver)", role: "approver", password: "Provisum@2026!", orgUnit: "Operations" },
    { username: "viewer", displayName: "Chris Reed (Viewer)", role: "viewer", password: "Provisum@2026!", orgUnit: null as string | null },
    { username: "security.lead", displayName: "Security Lead", role: "mapper", password: "Security@2026!", orgUnit: null as string | null },
    { username: "compliance.officer", displayName: "Compliance Officer", role: "approver", password: "Compliance@2026!", orgUnit: null as string | null },
    { username: "grc.analyst", displayName: "GRC Analyst", role: "viewer", password: "GrcAnalyst@2026!", orgUnit: null as string | null },
  ];

  for (const u of testUsers) {
    const ouId = u.orgUnit ? (orgUnitIdMap.get(u.orgUnit) ?? null) : null;
    const email = `${u.username}@provisum.local`;
    const supabaseAuthId = await createSupabaseAuthUser(email, u.password);

    await db.insert(schema.appUsers).values({
      organizationId: 1,
      username: u.username,
      displayName: u.displayName,
      email,
      passwordHash: "",
      role: u.role,
      assignedOrgUnitId: ouId,
      supabaseAuthId,
    });
  }

  // Create work assignments for the test users
  const [mapperFinance] = await db.select().from(schema.appUsers).where(eq(schema.appUsers.username, "mapper.finance"));
  const [mapperMaint] = await db.select().from(schema.appUsers).where(eq(schema.appUsers.username, "mapper.maintenance"));
  const [mapperProc] = await db.select().from(schema.appUsers).where(eq(schema.appUsers.username, "mapper.procurement"));
  const [approverFin] = await db.select().from(schema.appUsers).where(eq(schema.appUsers.username, "approver.finance"));
  const [approverOps] = await db.select().from(schema.appUsers).where(eq(schema.appUsers.username, "approver.operations"));

  const assignments = [
    { appUserId: mapperFinance.id, assignmentType: "mapper", scopeType: "department", scopeValue: "Finance" },
    { appUserId: mapperMaint.id, assignmentType: "mapper", scopeType: "department", scopeValue: "Maintenance" },
    { appUserId: mapperMaint.id, assignmentType: "mapper", scopeType: "department", scopeValue: "Facilities" },
    { appUserId: mapperProc.id, assignmentType: "mapper", scopeType: "department", scopeValue: "Procurement" },
    { appUserId: mapperProc.id, assignmentType: "mapper", scopeType: "department", scopeValue: "Supply Chain" },
    { appUserId: mapperProc.id, assignmentType: "mapper", scopeType: "department", scopeValue: "Warehouse" },
    { appUserId: approverFin.id, assignmentType: "approver", scopeType: "department", scopeValue: "Finance" },
    { appUserId: approverOps.id, assignmentType: "approver", scopeType: "department", scopeValue: "Maintenance" },
    { appUserId: approverOps.id, assignmentType: "approver", scopeType: "department", scopeValue: "Facilities" },
    { appUserId: approverOps.id, assignmentType: "approver", scopeType: "department", scopeValue: "Procurement" },
    { appUserId: approverOps.id, assignmentType: "approver", scopeType: "department", scopeValue: "Supply Chain" },
    { appUserId: approverOps.id, assignmentType: "approver", scopeType: "department", scopeValue: "Warehouse" },
  ];

  for (const a of assignments) {
    await db.insert(schema.workAssignments).values(a);
  }

  // ─── 12b. Self-Guided Demo Accounts (always created) ───
  const demoPassword = "DemoGuide2026!";
  const demoUsers = [
    { username: "demo.admin", displayName: "Demo Administrator", role: "admin", orgUnit: null as string | null },
    { username: "demo.mapper.finance", displayName: "Demo Finance Mapper", role: "mapper", orgUnit: "Finance" },
    { username: "demo.mapper.operations", displayName: "Demo Operations Mapper", role: "mapper", orgUnit: "Operations" },
    { username: "demo.approver", displayName: "Demo Approver", role: "approver", orgUnit: null as string | null },
    { username: "demo.pm", displayName: "Demo Project Manager", role: "project_manager", orgUnit: null as string | null },
    { username: "demo.coordinator", displayName: "Demo Coordinator", role: "coordinator", orgUnit: null as string | null },
    { username: "demo.viewer", displayName: "Demo Viewer", role: "viewer", orgUnit: null as string | null },
    { username: "demo.compliance", displayName: "Dana Compliance", role: "compliance_officer", orgUnit: null as string | null },
    { username: "demo.security", displayName: "Sam Security", role: "security_architect", orgUnit: null as string | null },
  ];

  for (const u of demoUsers) {
    const ouId = u.orgUnit ? (orgUnitIdMap.get(u.orgUnit) ?? null) : null;
    const email = `${u.username}@provisum.local`;
    const supabaseAuthId = await createSupabaseAuthUser(email, demoPassword);

    await db.insert(schema.appUsers).values({
      organizationId: 1,
      username: u.username,
      displayName: u.displayName,
      email,
      passwordHash: "",
      role: u.role,
      assignedOrgUnitId: ouId,
      demoEnvironment: "self-guided",
      supabaseAuthId,
    });
  }

  const [demoMapperFin] = await db.select().from(schema.appUsers).where(eq(schema.appUsers.username, "demo.mapper.finance"));
  const [demoMapperOps] = await db.select().from(schema.appUsers).where(eq(schema.appUsers.username, "demo.mapper.operations"));
  const [demoApprover] = await db.select().from(schema.appUsers).where(eq(schema.appUsers.username, "demo.approver"));

  const demoAssignments = [
    { appUserId: demoMapperFin.id, assignmentType: "mapper", scopeType: "department", scopeValue: "Finance" },
    { appUserId: demoMapperFin.id, assignmentType: "mapper", scopeType: "department", scopeValue: "Procurement" },
    { appUserId: demoMapperOps.id, assignmentType: "mapper", scopeType: "department", scopeValue: "Maintenance" },
    { appUserId: demoMapperOps.id, assignmentType: "mapper", scopeType: "department", scopeValue: "Supply Chain" },
    { appUserId: demoApprover.id, assignmentType: "approver", scopeType: "department", scopeValue: "Finance" },
    { appUserId: demoApprover.id, assignmentType: "approver", scopeType: "department", scopeValue: "Maintenance" },
    { appUserId: demoApprover.id, assignmentType: "approver", scopeType: "department", scopeValue: "Operations" },
  ];

  for (const a of demoAssignments) {
    await db.insert(schema.workAssignments).values(a);
  }

  console.log(`  ✓ ${demoUsers.length} self-guided demo accounts (always available)`);
  console.log("    Password: DemoGuide2026!");

  // ─── 13. Default System Settings ───
  // (system_settings already cleared by TRUNCATE CASCADE above)
  const defaultSettings = [
    { key: "project.name", value: "SAP S/4HANA Migration" },
    { key: "project.sourceSystem", value: "SAP ECC" },
    { key: "project.targetSystem", value: "SAP S/4HANA" },
    { key: "project.organization", value: "" },
    { key: "ai.provider", value: "claude" },
    { key: "ai.apiKey", value: "" },
    { key: "ai.model", value: "claude-sonnet-5" },
    { key: "ai.confidenceThreshold", value: "85" },
    { key: "workflow.autoApprove", value: "false" },
    { key: "workflow.approvalLevels", value: "single" },
    { key: "workflow.sodSeverity.critical", value: "never" },
    { key: "workflow.sodSeverity.high", value: "allowed" },
    { key: "workflow.sodSeverity.medium", value: "allowed" },
    { key: "workflow.sodSeverity.low", value: "allowed" },
    { key: "email_enabled", value: "true" },
    { key: "email_provider", value: "resend" },
    { key: "email_from_address", value: "Provisum <hello@provisum.io>" },
    { key: "email_from_name", value: "Provisum" },
    { key: "email_reply_to", value: "" },
  ];
  for (const s of defaultSettings) {
    await db.insert(schema.systemSettings).values({
      key: s.key,
      value: s.value,
      updatedBy: "system",
    });
  }
  console.log(`  ✓ ${defaultSettings.length} default system settings`);

  // ─── 14. Releases + Release Scoping ───
  // (release tables already cleared by TRUNCATE CASCADE above)

  const [wave1] = await db.insert(schema.releases).values({
    organizationId: 1,
    name: "Wave 1 — Finance & Operations",
    description: "First migration wave covering Finance, Procurement, and Operations departments.",
    status: "in_progress",
    releaseType: "initial",
    targetSystem: "SAP S/4HANA",
    isActive: true,
    createdBy: "system",
  }).returning();

  const [wave2] = await db.insert(schema.releases).values({
    organizationId: 1,
    name: "Wave 2 — Maintenance & IT",
    description: "Second wave covering Maintenance, Facilities, IT, and remaining departments.",
    status: "planning",
    releaseType: "incremental",
    targetSystem: "SAP S/4HANA",
    isActive: false,
    createdBy: "system",
  }).returning();

  console.log(`  ✓ 2 releases: Wave 1 (active), Wave 2 (planning)`);

  // Associate ALL users with Wave 1 (initial migration covers everyone)
  const seedAllUsers = await db.select({ id: schema.users.id, department: schema.users.department }).from(schema.users);
  const wave2Depts = new Set(["Maintenance", "Facilities Management", "IT", "Quality Control"]);

  for (const u of seedAllUsers) {
    await db.insert(schema.releaseUsers).values({ releaseId: wave1.id, userId: u.id });
    if (wave2Depts.has(u.department || "")) {
      await db.insert(schema.releaseUsers).values({ releaseId: wave2.id, userId: u.id });
    }
  }
  const wave2UserCount = seedAllUsers.filter(u => wave2Depts.has(u.department || "")).length;
  console.log(`  ✓ Release users: ${seedAllUsers.length} in Wave 1, ${wave2UserCount} in Wave 2`);

  // Associate all source roles, target roles, and SOD rules with Wave 1
  const seedSourceRoles = await db.select({ id: schema.sourceRoles.id }).from(schema.sourceRoles);
  const seedTargetRoles = await db.select({ id: schema.targetRoles.id }).from(schema.targetRoles);
  const seedSodRules = await db.select({ id: schema.sodRules.id }).from(schema.sodRules);

  for (const sr of seedSourceRoles) {
    await db.insert(schema.releaseSourceRoles).values({ releaseId: wave1.id, sourceRoleId: sr.id });
  }
  for (const tr of seedTargetRoles) {
    await db.insert(schema.releaseTargetRoles).values({ releaseId: wave1.id, targetRoleId: tr.id });
    await db.insert(schema.releaseTargetRoles).values({ releaseId: wave2.id, targetRoleId: tr.id });
  }
  for (const sr of seedSodRules) {
    await db.insert(schema.releaseSodRules).values({ releaseId: wave1.id, sodRuleId: sr.id });
    await db.insert(schema.releaseSodRules).values({ releaseId: wave2.id, sodRuleId: sr.id });
  }
  console.log(`  ✓ Release associations: ${seedSourceRoles.length} source roles, ${seedTargetRoles.length} target roles, ${seedSodRules.length} SOD rules`);

  // Assign app users to releases
  const appUserRows = await db.select({ id: schema.appUsers.id, role: schema.appUsers.role, username: schema.appUsers.username }).from(schema.appUsers);
  for (const au of appUserRows) {
    await db.insert(schema.appUserReleases).values({ appUserId: au.id, releaseId: wave1.id });
    if (["admin", "system_admin"].includes(au.role) || au.username.includes("maintenance") || au.username.includes("operations")) {
      await db.insert(schema.appUserReleases).values({ appUserId: au.id, releaseId: wave2.id });
    }
  }
  console.log(`  ✓ App user release assignments`);

  console.log(`  ✓ ${testUsers.length} app users + ${assignments.length} work assignments`);
  console.log("    Credentials:");
  console.log("    sysadmin / Sysadmin@2026! (system_admin — system settings + full access)");
  console.log("    admin / AdminPass@2026! (admin — full access)");
  console.log("    mapper.finance / Provisum@2026! (mapper — Finance dept)");
  console.log("    mapper.maintenance / Provisum@2026! (mapper — Maintenance + Facilities)");
  console.log("    mapper.procurement / Provisum@2026! (mapper — Procurement + Supply Chain + Warehouse)");
  console.log("    approver.finance / Provisum@2026! (approver — Finance dept)");
  console.log("    approver.operations / Provisum@2026! (approver — Maintenance + Facilities + Procurement + Supply Chain + Warehouse)");
  console.log("    viewer / Provisum@2026! (viewer — read-only)");
  console.log("    security.lead / Security@2026! (mapper — all depts, handles within-role conflicts & role design)");
  console.log("    compliance.officer / Compliance@2026! (approver — all depts, approves risk acceptances & reviews escalated conflicts)");
  console.log("    grc.analyst / GrcAnalyst@2026! (viewer — all depts, read-only audit & reporting)");

  // ─── Feature Flags ───
  const now = new Date().toISOString();
  await db.insert(schema.featureFlags).values([
    { key: "lumen_tool_calling", description: "Enable Lumen AI tool calling (Phase 2)", enabled: true, createdAt: now, updatedAt: now },
    { key: "bulk_mapping_ui", description: "Enable bulk mapping UI enhancements", enabled: true, createdAt: now, updatedAt: now },
    { key: "webhook_events", description: "Enable webhook event dispatching", enabled: false, createdAt: now, updatedAt: now },
    { key: "scheduled_exports", description: "Enable scheduled CSV export jobs", enabled: false, createdAt: now, updatedAt: now },
    { key: "confidence_calibration", description: "Enable AI confidence calibration review queue", enabled: false, createdAt: now, updatedAt: now },
  ]).onConflictDoNothing();
  console.log("  ✓ 5 default feature flags");

  // ─── 15. Permission Gap Analysis ───
  // Compute gaps: source permissions not covered by mapped target role permissions
  const seedPersonaSourcePerms = await db
    .select({
      personaId: schema.personaSourcePermissions.personaId,
      sourcePermissionId: schema.personaSourcePermissions.sourcePermissionId,
    })
    .from(schema.personaSourcePermissions);

  const seedPersonaTargetMappings = await db
    .select({
      personaId: schema.personaTargetRoleMappings.personaId,
      targetRoleId: schema.personaTargetRoleMappings.targetRoleId,
    })
    .from(schema.personaTargetRoleMappings);

  // Build target role → covered permission IDs
  const seedTargetRolePerms = new Map<number, Set<string>>();
  const seedTrpRows = await db.select({
    roleId: schema.targetRolePermissions.targetRoleId,
    permId: schema.targetPermissions.permissionId,
  }).from(schema.targetRolePermissions)
    .innerJoin(schema.targetPermissions, eq(schema.targetRolePermissions.targetPermissionId, schema.targetPermissions.id));
  for (const row of seedTrpRows) {
    if (!seedTargetRolePerms.has(row.roleId)) seedTargetRolePerms.set(row.roleId, new Set());
    seedTargetRolePerms.get(row.roleId)!.add(row.permId);
  }

  // Build source permission ID lookup
  const seedSourcePermLookup = new Map<number, string>();
  const seedAllSourcePerms = await db.select({ id: schema.sourcePermissions.id, permissionId: schema.sourcePermissions.permissionId }).from(schema.sourcePermissions);
  for (const sp of seedAllSourcePerms) seedSourcePermLookup.set(sp.id, sp.permissionId);

  // Build persona → mapped target roles
  const seedPersonaMappings = new Map<number, Set<number>>();
  for (const m of seedPersonaTargetMappings) {
    if (!seedPersonaMappings.has(m.personaId)) seedPersonaMappings.set(m.personaId, new Set());
    seedPersonaMappings.get(m.personaId)!.add(m.targetRoleId);
  }

  // Build persona → source permission DB IDs
  const seedPersonaSrcPerms = new Map<number, number[]>();
  for (const psp of seedPersonaSourcePerms) {
    if (!seedPersonaSrcPerms.has(psp.personaId)) seedPersonaSrcPerms.set(psp.personaId, []);
    seedPersonaSrcPerms.get(psp.personaId)!.push(psp.sourcePermissionId);
  }

  // Compute gaps — only for personas that have both source permissions AND target role mappings
  const seedGapRecords: { personaId: number; sourcePermissionId: number; gapType: string; notes: string }[] = [];
  for (const [personaId, srcPermIds] of Array.from(seedPersonaSrcPerms)) {
    const mappedRoles = seedPersonaMappings.get(personaId) || new Set<number>();
    // Skip personas with no target role mappings (not yet mapped, not a "gap")
    if (mappedRoles.size === 0) continue;
    const coveredPerms = new Set<string>();
    const mappedRoleArr = Array.from(mappedRoles);
    for (const trId of mappedRoleArr) {
      const perms = seedTargetRolePerms.get(trId);
      if (perms) { const permArr = Array.from(perms); for (const p of permArr) coveredPerms.add(p); }
    }
    for (const spDbId of srcPermIds) {
      const spId = seedSourcePermLookup.get(spDbId);
      if (spId && !coveredPerms.has(spId)) {
        seedGapRecords.push({
          personaId,
          sourcePermissionId: spDbId,
          gapType: "no_coverage",
          notes: `Source permission ${spId} not covered by any mapped target role`,
        });
      }
    }
  }

  if (seedGapRecords.length > 0) {
    for (let i = 0; i < seedGapRecords.length; i += 500) {
      await db.insert(schema.permissionGaps).values(seedGapRecords.slice(i, i + 500));
    }
    console.log(`  ✓ ${seedGapRecords.length} permission gaps computed`);
  } else {
    console.log("  ⊘ No persona source permissions to analyze for gaps");
  }

  // ─── Verification ───
  console.log("\n📊 Verification:");
  const counts = {
    users: (await db.select().from(schema.users)).length,
    consolidatedGroups: (await db.select().from(schema.consolidatedGroups)).length,
    personas: (await db.select().from(schema.personas)).length,
    sourceRoles: (await db.select().from(schema.sourceRoles)).length,
    sourcePermissions: (await db.select().from(schema.sourcePermissions)).length,
    rolePermissions: (await db.select().from(schema.sourceRolePermissions)).length,
    targetRoles: (await db.select().from(schema.targetRoles)).length,
    targetPermissions: (await db.select().from(schema.targetPermissions)).length,
    targetRolePermissions: (await db.select().from(schema.targetRolePermissions)).length,
    userPersonaAssignments: (await db.select().from(schema.userPersonaAssignments)).length,
    sodRules: (await db.select().from(schema.sodRules)).length,
    userTargetRoleAssignments: (await db.select().from(schema.userTargetRoleAssignments)).length,
    sodConflicts: (await db.select().from(schema.sodConflicts)).length,
  };
  console.log(counts);
  console.log("\n✅ Seed complete!");
}

// ─── Standalone entry point (only runs when executed directly via tsx) ───
const isDirectExecution = process.argv[1]?.includes("seed");
if (isDirectExecution) {
  const demoArg = process.argv.find((a) => a.startsWith("--demo="));
  const demoPack = demoArg ? demoArg.split("=")[1] : null;
  const packName = demoPack ?? "default";
  const csvDir = path.join(DATA_DIR, "demos", packName);

  if (!existsSync(csvDir)) {
    console.error(`❌ Demo pack not found: ${csvDir}`);
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("❌ DATABASE_URL environment variable is required");
    process.exit(1);
  }

  console.log(`📦 Using demo pack: ${packName}`);
  console.log(`   CSV directory: ${csvDir}`);
  console.log(`   Database: Supabase Postgres\n`);

  const client = postgres(connectionString, { max: 5 });
  const seedDb = drizzle(client, { schema });

  const readCsv = <T,>(filename: string): T[] => {
    const filepath = path.join(csvDir, filename);
    if (!existsSync(filepath)) return [];
    const content = readFileSync(filepath, "utf-8");
    return parse(content, { columns: true, skip_empty_lines: true, trim: true }) as T[];
  };

  runSeed(seedDb, readCsv)
    .then(() => client.end())
    .catch((err) => {
      console.error("❌ Seed failed:", err);
      client.end().then(() => process.exit(1));
    });
}
