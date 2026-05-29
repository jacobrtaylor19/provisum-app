import { pgTable, text, integer, real, serial, boolean, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─────────────────────────────────────────────
// ORGANIZATIONS (multi-tenant isolation)
// ─────────────────────────────────────────────

export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  settings: text("settings"), // JSON blob for org-level config
  planTier: text("plan_tier"), // "standard" | "professional" | "enterprise"
  maxUsers: integer("max_users"), // 500 standard, 3000 professional
  licenseYears: integer("license_years"), // 1, 2, or 3
  licenseExpiresAt: text("license_expires_at"), // ISO timestamp
  isActive: boolean("is_active").notNull().default(true),
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// ORG UNITS (organizational hierarchy L1/L2/L3)
// ─────────────────────────────────────────────

export const orgUnits = pgTable("org_units", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  name: text("name").notNull(),
  level: text("level").notNull(), // "L1", "L2", "L3"
  parentId: integer("parent_id"),
  description: text("description"),
});

// ─────────────────────────────────────────────
// USERS (source system users, normalized)
// ─────────────────────────────────────────────

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  sourceUserId: text("source_user_id").notNull().unique(),
  displayName: text("display_name").notNull(),
  email: text("email"),
  department: text("department"),
  jobTitle: text("job_title"),
  orgUnit: text("org_unit"),
  orgUnitId: integer("org_unit_id"),
  costCenter: text("cost_center"),
  userType: text("user_type").default("standard"),
  metadata: text("metadata"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// SOURCE ROLES (legacy system roles)
// ─────────────────────────────────────────────

export const sourceRoles = pgTable("source_roles", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  roleId: text("role_id").notNull().unique(),
  roleName: text("role_name").notNull(),
  description: text("description"),
  system: text("system").default("SAP ECC"),
  domain: text("domain"),
  roleType: text("role_type"),
  roleOwner: text("role_owner"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// SOURCE PERMISSIONS (T-codes, functions, etc.)
// ─────────────────────────────────────────────

export const sourcePermissions = pgTable("source_permissions", {
  id: serial("id").primaryKey(),
  permissionId: text("permission_id").notNull().unique(),
  permissionName: text("permission_name"),
  description: text("description"),
  system: text("system").default("SAP ECC"),
  permissionType: text("permission_type"),
  riskLevel: text("risk_level"),
});

// ─────────────────────────────────────────────
// SOURCE ROLE ↔ PERMISSION (junction)
// ─────────────────────────────────────────────

export const sourceRolePermissions = pgTable("source_role_permissions", {
  id: serial("id").primaryKey(),
  sourceRoleId: integer("source_role_id").notNull().references(() => sourceRoles.id, { onDelete: "cascade" }),
  sourcePermissionId: integer("source_permission_id").notNull().references(() => sourcePermissions.id, { onDelete: "cascade" }),
});

// ─────────────────────────────────────────────
// USER ↔ SOURCE ROLE ASSIGNMENTS
// ─────────────────────────────────────────────

export const userSourceRoleAssignments = pgTable("user_source_role_assignments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sourceRoleId: integer("source_role_id").notNull().references(() => sourceRoles.id, { onDelete: "cascade" }),
  assignedDate: text("assigned_date"),
});

// ─────────────────────────────────────────────
// CONSOLIDATED GROUPS (high-level security groups)
// ─────────────────────────────────────────────

export const consolidatedGroups = pgTable("consolidated_groups", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  name: text("name").notNull().unique(),
  description: text("description"),
  accessLevel: text("access_level"),
  domain: text("domain"),
  sortOrder: integer("sort_order"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// PERSONAS (security personas — AI-generated or manually uploaded)
// ─────────────────────────────────────────────

export const personas = pgTable("personas", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  name: text("name").notNull().unique(),
  description: text("description"),
  businessFunction: text("business_function"),
  consolidatedGroupId: integer("consolidated_group_id").references(() => consolidatedGroups.id),
  source: text("source").notNull().default("ai"),
  isActive: boolean("is_active").default(true),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// PERSONA ↔ SOURCE PERMISSION (characteristic permissions)
// ─────────────────────────────────────────────

export const personaSourcePermissions = pgTable("persona_source_permissions", {
  id: serial("id").primaryKey(),
  personaId: integer("persona_id").notNull().references(() => personas.id, { onDelete: "cascade" }),
  sourcePermissionId: integer("source_permission_id").notNull().references(() => sourcePermissions.id, { onDelete: "cascade" }),
  weight: real("weight").default(1.0),
  isRequired: boolean("is_required").default(false),
});

// ─────────────────────────────────────────────
// USER-PERSONA ASSIGNMENTS (AI output or manual)
// ─────────────────────────────────────────────

export const userPersonaAssignments = pgTable("user_persona_assignments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  personaId: integer("persona_id").references(() => personas.id),
  consolidatedGroupId: integer("consolidated_group_id").references(() => consolidatedGroups.id),
  confidenceScore: real("confidence_score"),
  aiReasoning: text("ai_reasoning"),
  aiModel: text("ai_model"),
  assignmentMethod: text("assignment_method"),
  jobRunId: integer("job_run_id").references(() => processingJobs.id),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// TARGET ROLES (future system roles)
// ─────────────────────────────────────────────

export const targetRoles = pgTable("target_roles", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  roleId: text("role_id").notNull().unique(),
  roleName: text("role_name").notNull(),
  description: text("description"),
  system: text("system").default("S/4HANA"),
  domain: text("domain"),
  capabilities: text("capabilities"),
  roleOwner: text("role_owner"),
  status: text("status").notNull().default("active"), // draft | active | archived
  source: text("source").notNull().default("uploaded"), // uploaded | ai_generated | manual
  approvedBy: integer("approved_by"),
  approvedAt: text("approved_at"),
  // Policy-drift baseline (#42): permission set captured at approval, used to detect
  // post-approval changes. Hash is sha256 of the sorted permissionId list; snapshot is
  // the JSON array of permissionIds. Null = no baseline yet (set on first approval/scan).
  approvedPermissionHash: text("approved_permission_hash"),
  approvedPermissionSnapshot: text("approved_permission_snapshot"),
  updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
  updatedBy: integer("updated_by"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// TARGET PERMISSIONS (future system permissions / Fiori apps)
// ─────────────────────────────────────────────

export const targetPermissions = pgTable("target_permissions", {
  id: serial("id").primaryKey(),
  permissionId: text("permission_id").notNull().unique(),
  permissionName: text("permission_name"),
  description: text("description"),
  system: text("system").default("S/4HANA"),
  permissionType: text("permission_type"),
  riskLevel: text("risk_level"),
});

// ─────────────────────────────────────────────
// TARGET TASK ROLES (Tier 2 — focused permission bundles)
// ─────────────────────────────────────────────

export const targetTaskRoles = pgTable("target_task_roles", {
  id: serial("id").primaryKey(),
  taskRoleId: text("task_role_id").notNull().unique(),
  taskRoleName: text("task_role_name").notNull(),
  description: text("description"),
  system: text("system").default("S/4HANA"),
  domain: text("domain"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// TARGET TASK ROLE ↔ PERMISSION (Tier 2 → Tier 1)
// ─────────────────────────────────────────────

export const targetTaskRolePermissions = pgTable("target_task_role_permissions", {
  id: serial("id").primaryKey(),
  targetTaskRoleId: integer("target_task_role_id").notNull().references(() => targetTaskRoles.id, { onDelete: "cascade" }),
  targetPermissionId: integer("target_permission_id").notNull().references(() => targetPermissions.id, { onDelete: "cascade" }),
});

// ─────────────────────────────────────────────
// TARGET SECURITY ROLE ↔ TASK ROLE (Tier 3 → Tier 2)
// ─────────────────────────────────────────────

export const targetSecurityRoleTasks = pgTable("target_security_role_tasks", {
  id: serial("id").primaryKey(),
  targetRoleId: integer("target_role_id").notNull().references(() => targetRoles.id, { onDelete: "cascade" }),
  targetTaskRoleId: integer("target_task_role_id").notNull().references(() => targetTaskRoles.id, { onDelete: "cascade" }),
});

// ─────────────────────────────────────────────
// TARGET ROLE ↔ PERMISSION (direct, Tier 3 → Tier 1)
// ─────────────────────────────────────────────

export const targetRolePermissions = pgTable("target_role_permissions", {
  id: serial("id").primaryKey(),
  targetRoleId: integer("target_role_id").notNull().references(() => targetRoles.id, { onDelete: "cascade" }),
  targetPermissionId: integer("target_permission_id").notNull().references(() => targetPermissions.id, { onDelete: "cascade" }),
});

// ─────────────────────────────────────────────
// PERSONA ↔ TARGET ROLE MAPPINGS
// ─────────────────────────────────────────────

export const personaTargetRoleMappings = pgTable("persona_target_role_mappings", {
  id: serial("id").primaryKey(),
  personaId: integer("persona_id").notNull().references(() => personas.id, { onDelete: "cascade" }),
  targetRoleId: integer("target_role_id").notNull().references(() => targetRoles.id, { onDelete: "cascade" }),
  mappingReason: text("mapping_reason"),
  coveragePercent: real("coverage_percent"),
  excessPercent: real("excess_percent"),
  confidence: text("confidence"),
  isActive: boolean("is_active").default(true),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// RELEASES (top-level migration wave/project)
// ─────────────────────────────────────────────

export const releases = pgTable("releases", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  name: text("name").notNull(),                                     // e.g. "Wave 1 — Finance Go-Live"
  description: text("description"),
  status: text("status").notNull().default("planning"),              // planning | in_progress | approved | completed | archived
  releaseType: text("release_type").notNull().default("initial"),    // initial | incremental | remediation
  defaultSourceSystemType: text("default_source_system_type").default("SAP_ECC"), // SAP_ECC | ORACLE_EBS | WORKDAY | etc.
  targetSystemType: text("target_system_type").default("SAP_S4HANA"),              // SAP_S4HANA | ORACLE_CLOUD | WORKDAY | etc.
  targetSystem: text("target_system"),                               // Legacy freetext — kept for backward compat
  targetDate: text("target_date"),                                   // ISO date string
  completedDate: text("completed_date"),
  mappingDeadline: text("mapping_deadline"),                          // ISO date — when mapping must be complete
  reviewDeadline: text("review_deadline"),                            // ISO date — when SOD review must be complete
  approvalDeadline: text("approval_deadline"),                        // ISO date — when approvals must be complete
  cutoverDate: text("cutover_date"),                                  // ISO date — system cutover / migration execution
  goLiveDate: text("go_live_date"),                                   // ISO date — users go live on new system
  isActive: boolean("is_active").default(true), // the currently "open" wave new assignments belong to
  createdBy: text("created_by"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// WORKSTREAM TRACKER
// RAID-style items scoped to role mapping workstream
// ─────────────────────────────────────────────

export const workstreamItems = pgTable("workstream_items", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  releaseId: integer("release_id"),                                    // optional link to a release
  category: text("category").notNull(),                                // risk | action | issue | decision
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("proposed"),                // proposed | approved | in_progress | resolved | rejected
  priority: text("priority").notNull().default("medium"),              // low | medium | high | critical
  owner: text("owner"),                                                // display name of responsible person
  proposedBy: integer("proposed_by"),                                  // appUser id
  proposedByName: text("proposed_by_name"),                            // denormalized display name
  approvedBy: integer("approved_by"),                                  // appUser id (PM/admin who approved)
  approvedByName: text("approved_by_name"),
  resolvedAt: text("resolved_at"),
  resolutionNotes: text("resolution_notes"),
  dueDate: text("due_date"),                                           // ISO date — when item should be resolved
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// RELEASE ↔ USER SCOPE (many-to-many)
// A user may be in-scope for multiple releases
// ─────────────────────────────────────────────

export const releaseUsers = pgTable("release_users", {
  id: serial("id").primaryKey(),
  releaseId: integer("release_id").notNull().references(() => releases.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  addedAt: text("added_at").notNull().$defaultFn(() => new Date().toISOString()),
  addedBy: text("added_by"),
});

// ─────────────────────────────────────────────
// RELEASE ↔ ORG UNIT SCOPE (many-to-many)
// A business unit / department may span multiple releases
// ─────────────────────────────────────────────

export const releaseOrgUnits = pgTable("release_org_units", {
  id: serial("id").primaryKey(),
  releaseId: integer("release_id").notNull().references(() => releases.id, { onDelete: "cascade" }),
  orgUnitId: integer("org_unit_id").notNull().references(() => orgUnits.id, { onDelete: "cascade" }),
  sourceSystemTypeOverride: text("source_system_type_override"), // null = inherit from release default
  addedAt: text("added_at").notNull().$defaultFn(() => new Date().toISOString()),
  addedBy: text("added_by"),
});

// ─────────────────────────────────────────────
// RELEASE ↔ SOURCE ROLE SCOPE (many-to-many)
// A source role can apply to one or more releases
// ─────────────────────────────────────────────

export const releaseSourceRoles = pgTable("release_source_roles", {
  id: serial("id").primaryKey(),
  releaseId: integer("release_id").notNull().references(() => releases.id, { onDelete: "cascade" }),
  sourceRoleId: integer("source_role_id").notNull().references(() => sourceRoles.id, { onDelete: "cascade" }),
  addedAt: text("added_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// RELEASE ↔ TARGET ROLE SCOPE (many-to-many)
// A target role can apply to one or more releases
// ─────────────────────────────────────────────

export const releaseTargetRoles = pgTable("release_target_roles", {
  id: serial("id").primaryKey(),
  releaseId: integer("release_id").notNull().references(() => releases.id, { onDelete: "cascade" }),
  targetRoleId: integer("target_role_id").notNull().references(() => targetRoles.id, { onDelete: "cascade" }),
  addedAt: text("added_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// RELEASE ↔ SOD RULE SCOPE (many-to-many)
// A SOD rule can apply to one or more releases
// ─────────────────────────────────────────────

export const releaseSodRules = pgTable("release_sod_rules", {
  id: serial("id").primaryKey(),
  releaseId: integer("release_id").notNull().references(() => releases.id, { onDelete: "cascade" }),
  sodRuleId: integer("sod_rule_id").notNull().references(() => sodRules.id, { onDelete: "cascade" }),
  addedAt: text("added_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// APP USER ↔ RELEASE ASSIGNMENTS (many-to-many)
// Which releases each platform user (mapper/approver/coordinator) can see
// ─────────────────────────────────────────────

export const appUserReleases = pgTable("app_user_releases", {
  id: serial("id").primaryKey(),
  appUserId: integer("app_user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  releaseId: integer("release_id").notNull().references(() => releases.id, { onDelete: "cascade" }),
  assignedAt: text("assigned_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// USER ↔ TARGET ROLE ASSIGNMENTS
// ─────────────────────────────────────────────

export const userTargetRoleAssignments = pgTable("user_target_role_assignments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  targetRoleId: integer("target_role_id").notNull().references(() => targetRoles.id),
  releaseId: integer("release_id").references(() => releases.id),   // null = legacy / pre-release tracking
  derivedFromPersonaId: integer("derived_from_persona_id").references(() => personas.id),
  assignmentType: text("assignment_type").notNull().default("persona_default"),
  status: text("status").notNull().default("draft"),
  releasePhase: text("release_phase").notNull().default("current"), // "existing" = previous wave (locked), "current" = this wave (editable)
  sodConflictCount: integer("sod_conflict_count").default(0),
  riskAcceptedBy: text("risk_accepted_by"),
  riskAcceptedAt: text("risk_accepted_at"),
  riskJustification: text("risk_justification"),
  approvedBy: text("approved_by"),
  approvedAt: text("approved_at"),
  sentBackReason: text("sent_back_reason"),
  mappedBy: text("mapped_by"),
  personaMappingChangedAt: text("persona_mapping_changed_at"), // set when persona-level change was pushed but individual override preserved
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// SOD RULES (segregation of duties ruleset)
// ─────────────────────────────────────────────

export const sodRules = pgTable("sod_rules", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  ruleId: text("rule_id").notNull().unique(),
  ruleName: text("rule_name").notNull(),
  description: text("description"),
  permissionA: text("permission_a").notNull(),
  permissionB: text("permission_b").notNull(),
  severity: text("severity").notNull().default("medium"),
  riskDescription: text("risk_description"),
  isActive: boolean("is_active").default(true),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// SOD CONFLICTS (detected violations)
// ─────────────────────────────────────────────

export const sodConflicts = pgTable("sod_conflicts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sodRuleId: integer("sod_rule_id").notNull().references(() => sodRules.id, { onDelete: "cascade" }),
  roleIdA: integer("role_id_a").references(() => targetRoles.id),
  roleIdB: integer("role_id_b").references(() => targetRoles.id),
  permissionIdA: text("permission_id_a"),
  permissionIdB: text("permission_id_b"),
  severity: text("severity").notNull(),
  conflictType: text("conflict_type").notNull().default("between_role"), // "between_role" or "within_role"
  resolutionStatus: text("resolution_status").notNull().default("open"),
  resolvedBy: text("resolved_by"),
  resolvedAt: text("resolved_at"),
  resolutionNotes: text("resolution_notes"),
  riskExplanation: text("risk_explanation"),
  mitigatingControl: text("mitigating_control"),
  controlOwner: text("control_owner"),
  controlFrequency: text("control_frequency"), // daily | weekly | monthly | quarterly | annual | ad_hoc
  controlLastReviewedAt: text("control_last_reviewed_at"),
  involvedExistingAccess: boolean("involved_existing_access").notNull().default(false),
  analysisJobId: integer("analysis_job_id").references(() => processingJobs.id),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// NOTIFICATIONS (demo — no email sent)
// ─────────────────────────────────────────────

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  fromUserId: integer("from_user_id").notNull().references(() => appUsers.id),
  toUserId: integer("to_user_id").notNull().references(() => appUsers.id),
  notificationType: text("notification_type").notNull().default("reminder"), // reminder | escalation | info
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  relatedEntityType: text("related_entity_type"), // "mapping" | "approval" | null
  relatedEntityId: integer("related_entity_id"),
  actionUrl: text("action_url"), // link to the page where the user can take action
  status: text("status").notNull().default("sent"), // sent | read
  readAt: text("read_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// LEAST ACCESS EXCEPTIONS
// ─────────────────────────────────────────────

export const leastAccessExceptions = pgTable("least_access_exceptions", {
  id: serial("id").primaryKey(),
  personaId: integer("persona_id").notNull().references(() => personas.id, { onDelete: "cascade" }),
  targetRoleId: integer("target_role_id").notNull().references(() => targetRoles.id, { onDelete: "cascade" }),
  excessPercent: real("excess_percent"),
  justification: text("justification").notNull(),
  acceptedBy: text("accepted_by").notNull(),
  acceptedAt: text("accepted_at").notNull(),
  status: text("status").notNull().default("accepted"), // "accepted" | "revoked"
  revokedBy: text("revoked_by"),
  revokedAt: text("revoked_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// PERMISSION GAPS
// ─────────────────────────────────────────────

export const permissionGaps = pgTable("permission_gaps", {
  id: serial("id").primaryKey(),
  personaId: integer("persona_id").notNull().references(() => personas.id, { onDelete: "cascade" }),
  sourcePermissionId: integer("source_permission_id").notNull().references(() => sourcePermissions.id),
  gapType: text("gap_type").notNull().default("no_coverage"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// USER GAP REVIEWS (per-user access change review)
// ─────────────────────────────────────────────

export const userGapReviews = pgTable("user_gap_reviews", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  reviewStatus: text("review_status").notNull().default("pending"), // pending | confirmed_as_is | remapped
  changeImpactLevel: text("change_impact_level").notNull().default("none"), // none | low | medium | high
  coveragePercent: real("coverage_percent"),
  uncoveredCount: integer("uncovered_count").default(0),
  newPermCount: integer("new_perm_count").default(0),
  sourceRoleCount: integer("source_role_count").default(0),
  targetRoleCount: integer("target_role_count").default(0),
  reviewedBy: integer("reviewed_by"),
  reviewedAt: text("reviewed_at"),
  reviewNotes: text("review_notes"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// PROCESSING JOBS
// ─────────────────────────────────────────────

export const processingJobs = pgTable("processing_jobs", {
  id: serial("id").primaryKey(),
  jobType: text("job_type").notNull(),
  status: text("status").notNull().default("queued"),
  totalRecords: integer("total_records").default(0),
  processed: integer("processed").default(0),
  failed: integer("failed").default(0),
  config: text("config"),
  errorLog: text("error_log"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// AUDIT LOG
// ─────────────────────────────────────────────

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  action: text("action").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  actorEmail: text("actor_email"),
  ipAddress: text("ip_address"),
  metadata: text("metadata"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// SECURITY DESIGN CHANGES (target system role diffs)
// Records when a target role's permissions change after mappings exist.
// The triggering mechanism (integration adapter) is a roadmap item;
// this table + the pending_design_review status are the plumbing.
// ─────────────────────────────────────────────

export const securityDesignChanges = pgTable("security_design_changes", {
  id: serial("id").primaryKey(),
  targetRoleId: integer("target_role_id").references(() => targetRoles.id, { onDelete: "cascade" }),
  changeType: text("change_type").notNull(), // "role_added" | "role_removed" | "role_modified" | "permission_added" | "permission_removed"
  roleName: text("role_name").notNull(),
  roleExternalId: text("role_external_id"),
  detail: text("detail").notNull(),
  changeDescription: text("change_description"), // kept for backward compat
  status: text("status").notNull().default("pending"), // "pending" | "accepted" | "dismissed"
  detectedAt: text("detected_at").notNull().$defaultFn(() => new Date().toISOString()),
  detectedBy: text("detected_by"), // "integration_adapter" | manual username
  affectedMappingCount: integer("affected_mapping_count").default(0),
  acknowledgedBy: text("acknowledged_by"),
  acknowledgedAt: text("acknowledged_at"),
  reviewedBy: integer("reviewed_by").references(() => appUsers.id),
  reviewedAt: text("reviewed_at"),
  organizationId: integer("organization_id").references(() => organizations.id),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// SYSTEM SETTINGS (key-value configuration store)
// ─────────────────────────────────────────────

export const systemSettings = pgTable("system_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedBy: text("updated_by"),
});

// ─────────────────────────────────────────────
// APP USERS (tool users — mappers, approvers, admins)
// ─────────────────────────────────────────────

export const appUsers = pgTable("app_users", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  email: text("email"),
  passwordHash: text("password_hash").notNull().default(""),
  role: text("role").notNull().default("viewer"),
  assignedOrgUnitId: integer("assigned_org_unit_id"),
  isActive: boolean("is_active").default(true),
  failedLoginAttempts: integer("failed_login_attempts").default(0),
  lockedUntil: integer("locked_until"),
  demoEnvironment: text("demo_environment"),
  supabaseAuthId: text("supabase_auth_id").unique(),
  tosAcceptedAt: text("tos_accepted_at"),
  tosVersion: text("tos_version"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// USER INVITES (email-based invite flow)
// ─────────────────────────────────────────────

export const userInvites = pgTable("user_invites", {
  id: serial("id").primaryKey(),
  appUserId: integer("app_user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  email: text("email").notNull(),
  status: text("status").notNull().default("pending"), // pending | accepted | expired
  expiresAt: text("expires_at").notNull(),
  acceptedAt: text("accepted_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// APP USER SESSIONS
// ─────────────────────────────────────────────

export const appUserSessions = pgTable("app_user_sessions", {
  id: serial("id").primaryKey(),
  sessionToken: text("session_token").notNull().unique(),
  appUserId: integer("app_user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// WORK ASSIGNMENTS (mapper/approver → department/user)
// ─────────────────────────────────────────────

export const workAssignments = pgTable("work_assignments", {
  id: serial("id").primaryKey(),
  appUserId: integer("app_user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  assignmentType: text("assignment_type").notNull(),
  scopeType: text("scope_type").notNull(),
  scopeValue: text("scope_value").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// REVIEW LINKS (shareable read-only external reviewer snapshots)
// ─────────────────────────────────────────────

export const reviewLinks = pgTable("review_links", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  createdBy: integer("created_by").notNull().references(() => appUsers.id),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});


// ─────────────────────────────────────────────
// PERSONA CONFIRMATIONS (gate before target role mapping)
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// RATE LIMIT ENTRIES (DB-backed rate limiter for multi-isolate deployments)
// ─────────────────────────────────────────────

export const rateLimitEntries = pgTable("rate_limit_entries", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  count: integer("count").notNull().default(1),
  windowStart: text("window_start").notNull(),
  windowEnd: text("window_end").notNull(),
});

// ─────────────────────────────────────────────
// FEATURE FLAGS (DB-backed gradual rollouts)
// ─────────────────────────────────────────────

export const featureFlags = pgTable("feature_flags", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  description: text("description"),
  enabled: boolean("enabled").notNull().default(false),
  enabledForRoles: text("enabled_for_roles"), // JSON array of role strings, null = all roles
  enabledForUsers: text("enabled_for_users"), // JSON array of app_user IDs, null = all users
  percentage: integer("percentage"), // 0-100 for gradual rollout, null = use enabled flag
  metadata: text("metadata"), // JSON blob for extra config
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// PERSONA CONFIRMATIONS (gate before target role mapping)
// ─────────────────────────────────────────────

export const personaConfirmations = pgTable("persona_confirmations", {
  id: serial("id").primaryKey(),
  orgUnitId: integer("org_unit_id").notNull().references(() => orgUnits.id, { onDelete: "cascade" }),
  confirmedAt: text("confirmed_at"),
  confirmedBy: integer("confirmed_by").references(() => appUsers.id),
  resetAt: text("reset_at"),
  resetBy: integer("reset_by").references(() => appUsers.id),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// WEBHOOK ENDPOINTS & DELIVERIES
// ─────────────────────────────────────────────

export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: serial("id").primaryKey(),
  url: text("url").notNull(),
  description: text("description"),
  secret: text("secret").notNull(), // HMAC signing secret
  events: text("events").notNull(), // JSON array of event types to subscribe to
  enabled: boolean("enabled").notNull().default(true),
  failureCount: integer("failure_count").notNull().default(0),
  lastFailureAt: text("last_failure_at"),
  lastSuccessAt: text("last_success_at"),
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: serial("id").primaryKey(),
  endpointId: integer("endpoint_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: text("payload").notNull(), // JSON
  status: text("status").notNull().default("pending"), // pending, delivered, failed
  httpStatus: integer("http_status"),
  responseBody: text("response_body"),
  attempts: integer("attempts").notNull().default(0),
  nextRetryAt: text("next_retry_at"),
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
});

// ═══════════════════════════════════════════════
// RELATIONS (for Drizzle query builder)
// ═══════════════════════════════════════════════

export const orgUnitsRelations = relations(orgUnits, ({ one, many }) => ({
  parent: one(orgUnits, { fields: [orgUnits.parentId], references: [orgUnits.id], relationName: "parentChild" }),
  children: many(orgUnits, { relationName: "parentChild" }),
  users: many(users),
  assignedAppUsers: many(appUsers),
  personaConfirmations: many(personaConfirmations),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  orgUnitRef: one(orgUnits, { fields: [users.orgUnitId], references: [orgUnits.id] }),
  sourceRoleAssignments: many(userSourceRoleAssignments),
  personaAssignments: many(userPersonaAssignments),
  targetRoleAssignments: many(userTargetRoleAssignments),
  sodConflicts: many(sodConflicts),
}));

export const sourceRolesRelations = relations(sourceRoles, ({ many }) => ({
  userAssignments: many(userSourceRoleAssignments),
  permissions: many(sourceRolePermissions),
}));

export const sourcePermissionsRelations = relations(sourcePermissions, ({ many }) => ({
  roleAssignments: many(sourceRolePermissions),
  personaPermissions: many(personaSourcePermissions),
  gaps: many(permissionGaps),
}));

export const sourceRolePermissionsRelations = relations(sourceRolePermissions, ({ one }) => ({
  sourceRole: one(sourceRoles, { fields: [sourceRolePermissions.sourceRoleId], references: [sourceRoles.id] }),
  sourcePermission: one(sourcePermissions, { fields: [sourceRolePermissions.sourcePermissionId], references: [sourcePermissions.id] }),
}));

export const userSourceRoleAssignmentsRelations = relations(userSourceRoleAssignments, ({ one }) => ({
  user: one(users, { fields: [userSourceRoleAssignments.userId], references: [users.id] }),
  sourceRole: one(sourceRoles, { fields: [userSourceRoleAssignments.sourceRoleId], references: [sourceRoles.id] }),
}));

export const consolidatedGroupsRelations = relations(consolidatedGroups, ({ many }) => ({
  personas: many(personas),
  assignments: many(userPersonaAssignments),
}));

export const personasRelations = relations(personas, ({ one, many }) => ({
  consolidatedGroup: one(consolidatedGroups, { fields: [personas.consolidatedGroupId], references: [consolidatedGroups.id] }),
  sourcePermissions: many(personaSourcePermissions),
  userAssignments: many(userPersonaAssignments),
  targetRoleMappings: many(personaTargetRoleMappings),
  permissionGaps: many(permissionGaps),
}));

export const personaSourcePermissionsRelations = relations(personaSourcePermissions, ({ one }) => ({
  persona: one(personas, { fields: [personaSourcePermissions.personaId], references: [personas.id] }),
  sourcePermission: one(sourcePermissions, { fields: [personaSourcePermissions.sourcePermissionId], references: [sourcePermissions.id] }),
}));

export const userPersonaAssignmentsRelations = relations(userPersonaAssignments, ({ one }) => ({
  user: one(users, { fields: [userPersonaAssignments.userId], references: [users.id] }),
  persona: one(personas, { fields: [userPersonaAssignments.personaId], references: [personas.id] }),
  consolidatedGroup: one(consolidatedGroups, { fields: [userPersonaAssignments.consolidatedGroupId], references: [consolidatedGroups.id] }),
  job: one(processingJobs, { fields: [userPersonaAssignments.jobRunId], references: [processingJobs.id] }),
}));

export const targetRolesRelations = relations(targetRoles, ({ many }) => ({
  directPermissions: many(targetRolePermissions),
  taskRoles: many(targetSecurityRoleTasks),
  personaMappings: many(personaTargetRoleMappings),
  userAssignments: many(userTargetRoleAssignments),
  designChanges: many(securityDesignChanges),
}));

export const targetTaskRolesRelations = relations(targetTaskRoles, ({ many }) => ({
  permissions: many(targetTaskRolePermissions),
  securityRoles: many(targetSecurityRoleTasks),
}));

export const targetTaskRolePermissionsRelations = relations(targetTaskRolePermissions, ({ one }) => ({
  targetTaskRole: one(targetTaskRoles, { fields: [targetTaskRolePermissions.targetTaskRoleId], references: [targetTaskRoles.id] }),
  targetPermission: one(targetPermissions, { fields: [targetTaskRolePermissions.targetPermissionId], references: [targetPermissions.id] }),
}));

export const targetSecurityRoleTasksRelations = relations(targetSecurityRoleTasks, ({ one }) => ({
  targetRole: one(targetRoles, { fields: [targetSecurityRoleTasks.targetRoleId], references: [targetRoles.id] }),
  targetTaskRole: one(targetTaskRoles, { fields: [targetSecurityRoleTasks.targetTaskRoleId], references: [targetTaskRoles.id] }),
}));

export const targetPermissionsRelations = relations(targetPermissions, ({ many }) => ({
  directRoleAssignments: many(targetRolePermissions),
  taskRoleAssignments: many(targetTaskRolePermissions),
}));

export const targetRolePermissionsRelations = relations(targetRolePermissions, ({ one }) => ({
  targetRole: one(targetRoles, { fields: [targetRolePermissions.targetRoleId], references: [targetRoles.id] }),
  targetPermission: one(targetPermissions, { fields: [targetRolePermissions.targetPermissionId], references: [targetPermissions.id] }),
}));

export const personaTargetRoleMappingsRelations = relations(personaTargetRoleMappings, ({ one }) => ({
  persona: one(personas, { fields: [personaTargetRoleMappings.personaId], references: [personas.id] }),
  targetRole: one(targetRoles, { fields: [personaTargetRoleMappings.targetRoleId], references: [targetRoles.id] }),
}));

export const releasesRelations = relations(releases, ({ many }) => ({
  assignments: many(userTargetRoleAssignments),
  releaseUsers: many(releaseUsers),
  releaseOrgUnits: many(releaseOrgUnits),
  releaseSourceRoles: many(releaseSourceRoles),
  releaseTargetRoles: many(releaseTargetRoles),
  releaseSodRules: many(releaseSodRules),
  appUserReleases: many(appUserReleases),
}));

export const releaseUsersRelations = relations(releaseUsers, ({ one }) => ({
  release: one(releases, { fields: [releaseUsers.releaseId], references: [releases.id] }),
  user: one(users, { fields: [releaseUsers.userId], references: [users.id] }),
}));

export const releaseOrgUnitsRelations = relations(releaseOrgUnits, ({ one }) => ({
  release: one(releases, { fields: [releaseOrgUnits.releaseId], references: [releases.id] }),
  orgUnit: one(orgUnits, { fields: [releaseOrgUnits.orgUnitId], references: [orgUnits.id] }),
}));

export const releaseSourceRolesRelations = relations(releaseSourceRoles, ({ one }) => ({
  release: one(releases, { fields: [releaseSourceRoles.releaseId], references: [releases.id] }),
  sourceRole: one(sourceRoles, { fields: [releaseSourceRoles.sourceRoleId], references: [sourceRoles.id] }),
}));

export const releaseTargetRolesRelations = relations(releaseTargetRoles, ({ one }) => ({
  release: one(releases, { fields: [releaseTargetRoles.releaseId], references: [releases.id] }),
  targetRole: one(targetRoles, { fields: [releaseTargetRoles.targetRoleId], references: [targetRoles.id] }),
}));

export const releaseSodRulesRelations = relations(releaseSodRules, ({ one }) => ({
  release: one(releases, { fields: [releaseSodRules.releaseId], references: [releases.id] }),
  sodRule: one(sodRules, { fields: [releaseSodRules.sodRuleId], references: [sodRules.id] }),
}));

export const appUserReleasesRelations = relations(appUserReleases, ({ one }) => ({
  appUser: one(appUsers, { fields: [appUserReleases.appUserId], references: [appUsers.id] }),
  release: one(releases, { fields: [appUserReleases.releaseId], references: [releases.id] }),
}));

export const userTargetRoleAssignmentsRelations = relations(userTargetRoleAssignments, ({ one }) => ({
  user: one(users, { fields: [userTargetRoleAssignments.userId], references: [users.id] }),
  targetRole: one(targetRoles, { fields: [userTargetRoleAssignments.targetRoleId], references: [targetRoles.id] }),
  derivedFromPersona: one(personas, { fields: [userTargetRoleAssignments.derivedFromPersonaId], references: [personas.id] }),
  release: one(releases, { fields: [userTargetRoleAssignments.releaseId], references: [releases.id] }),
}));

export const sodRulesRelations = relations(sodRules, ({ many }) => ({
  conflicts: many(sodConflicts),
}));

export const sodConflictsRelations = relations(sodConflicts, ({ one }) => ({
  user: one(users, { fields: [sodConflicts.userId], references: [users.id] }),
  sodRule: one(sodRules, { fields: [sodConflicts.sodRuleId], references: [sodRules.id] }),
  roleA: one(targetRoles, { fields: [sodConflicts.roleIdA], references: [targetRoles.id] }),
  analysisJob: one(processingJobs, { fields: [sodConflicts.analysisJobId], references: [processingJobs.id] }),
}));

export const permissionGapsRelations = relations(permissionGaps, ({ one }) => ({
  persona: one(personas, { fields: [permissionGaps.personaId], references: [personas.id] }),
  sourcePermission: one(sourcePermissions, { fields: [permissionGaps.sourcePermissionId], references: [sourcePermissions.id] }),
}));

export const appUsersRelations = relations(appUsers, ({ one, many }) => ({
  assignedOrgUnit: one(orgUnits, { fields: [appUsers.assignedOrgUnitId], references: [orgUnits.id] }),
  sessions: many(appUserSessions),
  workAssignments: many(workAssignments),
}));

export const appUserSessionsRelations = relations(appUserSessions, ({ one }) => ({
  appUser: one(appUsers, { fields: [appUserSessions.appUserId], references: [appUsers.id] }),
}));

export const workAssignmentsRelations = relations(workAssignments, ({ one }) => ({
  appUser: one(appUsers, { fields: [workAssignments.appUserId], references: [appUsers.id] }),
}));

export const securityDesignChangesRelations = relations(securityDesignChanges, ({ one }) => ({
  targetRole: one(targetRoles, { fields: [securityDesignChanges.targetRoleId], references: [targetRoles.id] }),
}));

export const personaConfirmationsRelations = relations(personaConfirmations, ({ one }) => ({
  orgUnit: one(orgUnits, { fields: [personaConfirmations.orgUnitId], references: [orgUnits.id] }),
  confirmer: one(appUsers, { fields: [personaConfirmations.confirmedBy], references: [appUsers.id], relationName: "confirmer" }),
  resetter: one(appUsers, { fields: [personaConfirmations.resetBy], references: [appUsers.id], relationName: "resetter" }),
}));

// ─────────────────────────────────────────────
// SCHEDULED EXPORTS (recurring CSV/Excel exports)
// ─────────────────────────────────────────────

export const scheduledExports = pgTable("scheduled_exports", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  exportType: text("export_type").notNull(), // "excel", "csv_users", "csv_mappings", "csv_sod", "provisioning"
  schedule: text("schedule").notNull(), // "daily", "weekly", "monthly"
  dayOfWeek: integer("day_of_week"), // 0-6 for weekly, null for daily
  dayOfMonth: integer("day_of_month"), // 1-28 for monthly, null for others
  hour: integer("hour").notNull().default(6), // UTC hour to run (0-23)
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: text("last_run_at"),
  lastRunStatus: text("last_run_status"), // "success", "failed"
  lastRunError: text("last_run_error"),
  nextRunAt: text("next_run_at"),
  createdBy: integer("created_by").notNull(),
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// CHAT CONVERSATIONS (Lumen chat history persistence)
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// MAPPING FEEDBACK (AI suggestion accept/reject tracking)
// ─────────────────────────────────────────────

export const mappingFeedback = pgTable("mapping_feedback", {
  id: serial("id").primaryKey(),
  personaId: integer("persona_id").notNull().references(() => personas.id),
  targetRoleId: integer("target_role_id").notNull().references(() => targetRoles.id),
  accepted: boolean("accepted").notNull(),
  aiConfidence: integer("ai_confidence"),
  aiReasoning: text("ai_reasoning"),
  createdBy: integer("created_by").references(() => appUsers.id),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// INCIDENTS (automated technical support)
// ─────────────────────────────────────────────

export const incidents = pgTable("incidents", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  severity: text("severity").notNull(), // critical, high, medium, low
  status: text("status").notNull().default("open"), // open, investigating, resolved, dismissed
  source: text("source").notNull(), // sentry, health_check, job_failure, webhook_failure, manual
  sourceRef: text("source_ref"), // external ID (Sentry event ID, job ID, etc.)

  // AI triage
  aiClassification: text("ai_classification"), // JSON: { category, rootCause, suggestedFix, confidence, blastRadius }
  aiTriagedAt: text("ai_triaged_at"),

  // Resolution
  resolution: text("resolution"),
  resolvedBy: integer("resolved_by").references(() => appUsers.id),
  resolvedAt: text("resolved_at"),

  // Context
  affectedComponent: text("affected_component"), // e.g., "ai_pipeline", "auth", "database", "export"
  affectedUsers: integer("affected_users"), // estimated count
  metadata: text("metadata"), // JSON: additional context

  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const chatConversations = pgTable("chat_conversations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(), // FK to app_users
  title: text("title"), // auto-generated from first message
  messages: text("messages").notNull(), // JSON array of {role, content, toolUse?}
  messageCount: integer("message_count").notNull().default(0),
  lastMessageAt: text("last_message_at"),
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
});

// ── SOD Triage Workspaces ─────────────────────────────────────────
export const securityWorkItems = pgTable("security_work_items", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  sodConflictId: integer("sod_conflict_id").notNull(),
  targetRoleId: integer("target_role_id").notNull(),
  createdByUserId: integer("created_by_user_id").notNull(),
  assignedToUserId: integer("assigned_to_user_id"),
  status: text("status").notNull().default("open"), // open | in_progress | resolved | wont_fix
  complianceNotes: text("compliance_notes"),
  securityNotes: text("security_notes"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// EVIDENCE PACKAGE RUNS (SOX/ITGC audit evidence generation history)
// ─────────────────────────────────────────────

export const evidencePackageRuns = pgTable("evidence_package_runs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  releaseId: integer("release_id"),
  generatedByUserId: integer("generated_by_user_id").notNull(),
  generatedByUsername: text("generated_by_username").notNull(),
  framework: text("framework").notNull().default("sox_404"),
  status: text("status").notNull().default("completed"),
  userCount: integer("user_count").notNull().default(0),
  personaCount: integer("persona_count").notNull().default(0),
  assignmentCount: integer("assignment_count").notNull().default(0),
  sodConflictCount: integer("sod_conflict_count").notNull().default(0),
  // SHA-256 hex digest of the generated Excel payload — set by emitIntegrityHash()
  // after generation. Null on legacy rows created before A1.1.
  hash: text("hash"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// SSO CONFIGURATIONS (enterprise SSO/SAML)
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// DEMO LEADS (lead capture for demo access)
// ─────────────────────────────────────────────

export const demoLeads = pgTable("demo_leads", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  company: text("company"),
  role: text("role"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  source: text("source").default("demo_overview"),
});

// ─────────────────────────────────────────────
// SSO CONFIGURATIONS (enterprise SSO/SAML)
// ─────────────────────────────────────────────

export const ssoConfigurations = pgTable("sso_configurations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  provider: text("provider").notNull(), // azure_ad | okta | generic_saml
  providerName: text("provider_name"),
  domain: text("domain"), // email domain for auto-discovery
  metadataUrl: text("metadata_url"),
  metadataXml: text("metadata_xml"),
  supabaseSsoId: text("supabase_sso_id"),
  enabled: boolean("enabled").notNull().default(false),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// PROVISIONING REQUESTS (tracks get-started purchases)
// ─────────────────────────────────────────────

export const provisioningRequests = pgTable("provisioning_requests", {
  id: serial("id").primaryKey(),
  externalId: text("external_id").notNull().unique(),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  company: text("company").notNull(),
  orgName: text("org_name").notNull(),
  plan: text("plan").notNull(), // "standard" | "professional"
  licenseYears: integer("license_years").notNull(),
  totalAmount: integer("total_amount").notNull(),
  status: text("status").notNull().default("pending"), // pending | welcome_sent | provisioning | ready | failed
  organizationId: integer("organization_id"),
  errorMessage: text("error_message"),
  workflowRunId: text("workflow_run_id"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────
// APPEND-ONLY HISTORY TABLES (A1.2 — defensibility chassis)
//
// These tables capture point-in-time snapshots of evidence-persistent rows
// on every INSERT, UPDATE, and DELETE via Postgres triggers. They enable:
//   - "What was the state of assignment X at go-live date Y?" queries
//   - Proof that an approved mapping was not altered post-approval
//   - The getStateAsOf() query helper in lib/history.ts
//
// UUID PKs per Cursus schema alignment (docs/Provisum_Cursus_Architectural_Alignment.md).
// The live tables retain their serial PKs; only the history tables use UUIDs.
//
// DO NOT INSERT INTO these tables directly. The Postgres triggers on the live
// tables populate them automatically. Read-only from application code.
// ─────────────────────────────────────────────

export const userPersonaAssignmentsHistory = pgTable("user_persona_assignments_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  originalRowId: integer("original_row_id").notNull(),
  orgId: integer("org_id").notNull(),
  // JSON snapshot of the full live row at the moment of change
  snapshotJson: text("snapshot_json").notNull(),
  changedBy: text("changed_by").notNull().default("system"),
  changedAt: text("changed_at").notNull().$defaultFn(() => new Date().toISOString()),
  // insert | update | delete
  changeKind: text("change_kind").notNull(),
});

export const personaTargetRoleMappingsHistory = pgTable("persona_target_role_mappings_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  originalRowId: integer("original_row_id").notNull(),
  orgId: integer("org_id").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  changedBy: text("changed_by").notNull().default("system"),
  changedAt: text("changed_at").notNull().$defaultFn(() => new Date().toISOString()),
  changeKind: text("change_kind").notNull(),
});

export const sodConflictsHistory = pgTable("sod_conflicts_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  originalRowId: integer("original_row_id").notNull(),
  orgId: integer("org_id").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  changedBy: text("changed_by").notNull().default("system"),
  changedAt: text("changed_at").notNull().$defaultFn(() => new Date().toISOString()),
  changeKind: text("change_kind").notNull(),
});

// ─────────────────────────────────────────────
// ADAPTER CREDENTIAL VAULT (#34)
//
// Per-org encrypted storage for target-system adapter credentials
// (SAP username/password, Workday OAuth tokens, ServiceNow API keys, etc.).
// Secrets are stored AES-256-GCM encrypted via lib/encryption.ts.
// The plaintext is NEVER returned by any API — callers receive only metadata.
// Credentials are decrypted in-process only at connection time.
// ─────────────────────────────────────────────

export const adapterCredentials = pgTable("adapter_credentials", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  // Which adapter family these credentials are for
  adapterType: text("adapter_type").notNull(), // 'sap_s4hana' | 'workday' | 'oracle_fusion' | 'servicenow'
  // Human-friendly label, e.g. "Production SAP" or "HR Workday"
  name: text("name").notNull(),
  // AES-256-GCM encrypted JSON blob — never exposed via API
  credentialsEnc: text("credentials_enc").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  // ISO 8601 timestamp of last connection test (nullable)
  lastTestedAt: text("last_tested_at"),
  // 'success' | 'failed' | null
  lastTestStatus: text("last_test_status"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});
