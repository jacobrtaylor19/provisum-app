# Engagement vs. Evidence — Schema Classification

**Version:** v1.5.0 · **Date:** 2026-05-19 · **Author:** Claude (A1.4, UX brief Sprint 1)

This document supports **Founder Decision 1.1 — Artifact Continuity SKU**:
> Engagement-plus-archive-included for 24 months, or engagement-plus-annual-read-only-renewal?

Every table in `db/schema.ts` is classified below as either:

- **`engagement_bounded`** — Data whose primary value is operational during the migration project window. Safe to retire (read-only or export-only) after go-live + retention period. Does not need to be queryable by auditors 3+ years later.
- **`evidence_persistent`** — Data that constitutes or directly supports the audit trail and compliance record. Must remain queryable and tamper-evident after the project ends. Drives the artifact-continuity pricing decision.
- **`ambiguous`** — Cases where the correct classification depends on the founder decision or future product direction. Trade-offs are articulated below.

---

## Classified Tables (57 total)

### Core Tenant & Org

| Table | Classification | Rationale |
|-------|---------------|-----------|
| `organizations` | `ambiguous` | The org record itself is a lightweight metadata container. In engagement-bounded mode it could be archived. But it is the FK anchor for all evidence-persistent rows — it must remain at least as a stub for referential integrity. **Recommendation:** keep as a read-only tombstone post-engagement. |
| `orgUnits` | `engagement_bounded` | Represents the org-unit structure at migration time, which may not reflect post-go-live structure. Useful for historical context but not an audit deliverable. |
| `appUsers` | `engagement_bounded` | Login accounts for the tool's operators (mappers, approvers, etc.). Not the same as the migrated end-users. Can be deactivated post-engagement. |
| `userInvites` | `engagement_bounded` | Transient invite tokens. Expired or accepted invites have no post-engagement value. |
| `appUserSessions` | `engagement_bounded` | JWT session metadata. No compliance value after session expires. |
| `systemSettings` | `engagement_bounded` | Tool configuration (thresholds, email settings). Per-engagement, not audit-relevant. |
| `featureFlags` | `engagement_bounded` | Operational flags for the tool. No post-engagement value. |

### Source System Data

| Table | Classification | Rationale |
|-------|---------------|-----------|
| `users` | `engagement_bounded` | Employee roster at migration time. Loaded from the source system, not a Provisum-originated artifact. May contain PII — retention policy applies. |
| `sourceRoles` | `engagement_bounded` | Source system role catalog (e.g., SAP ECC roles). Input data, not output. |
| `sourcePermissions` | `engagement_bounded` | Permission catalog from the source system. Input data. |
| `sourceRolePermissions` | `engagement_bounded` | Source-side role-to-permission mappings. Input data. |
| `userSourceRoleAssignments` | `engagement_bounded` | Each user's source-system access. Input data. Potential PII. |

### Personas & Mappings (Core Output)

| Table | Classification | Rationale |
|-------|---------------|-----------|
| `consolidatedGroups` | `engagement_bounded` | Intermediate grouping used during persona design. Not referenced by auditors directly. |
| `personas` | **`ambiguous`** | **This is the most important ambiguous case.** Personas are the AI-designed security archetypes — they are the intellectual output of the migration. Auditors may need to trace "why was user X assigned role Y" → which requires the persona record. Strong case for `evidence_persistent`. However, personas may be redesigned or merged post-go-live, making the snapshot approach (history table) more appropriate than live persistence. **Recommendation:** classify as `evidence_persistent` for the snapshot record; live table is `engagement_bounded`. |
| `personaSourcePermissions` | `engagement_bounded` | Derived permission weights used for AI matching. Intermediate computation, not a compliance deliverable. |
| `userPersonaAssignments` | **`evidence_persistent`** | The record of which user was assigned to which persona. Directly answers auditor question: "How was user X classified for role mapping?" **History table required** (see A1.2). |
| `personaTargetRoleMappings` | **`evidence_persistent`** | The mapping from persona to target role(s). Core deliverable — this IS the migration design. Auditors need it to validate that each user class got the right access. **History table required** (A1.2). |

### Target System Design

| Table | Classification | Rationale |
|-------|---------------|-----------|
| `targetRoles` | **`evidence_persistent`** | The approved target role catalog. Auditors reference this to confirm which roles exist in the new system and whether they were properly designed. |
| `targetPermissions` | **`evidence_persistent`** | Target role permission catalog. Part of the security design that auditors review. |
| `targetTaskRoles` | `engagement_bounded` | SAP task-role linkage — adapter-layer data used during configuration, not a primary audit artifact. |
| `targetTaskRolePermissions` | `engagement_bounded` | Same as above. Adapter-layer, not primary audit artifact. |
| `targetSecurityRoleTasks` | `engagement_bounded` | Same. |
| `targetRolePermissions` | **`evidence_persistent`** | The explicit permission assignments on target roles. Required to answer "what access does this role grant?" |
| `securityDesignChanges` | **`evidence_persistent`** | Diff records detecting changes to the target design after initial configuration. Directly supports the defensibility claim: "The design was stable from approval to go-live." |

### Assignments & Approvals (Core Deliverable)

| Table | Classification | Rationale |
|-------|---------------|-----------|
| `userTargetRoleAssignments` | **`evidence_persistent`** | The approved assignments — who gets what role. The primary compliance artifact. Must be read-queryable for 3–7 years (SOX/SOC 2 retention). **History table required** (A1.2). |
| `sodRules` | **`evidence_persistent`** | The SoD rule definitions that were in effect during the project. Auditors need these to validate that the conflict analysis was run against the correct ruleset. |
| `sodConflicts` | **`evidence_persistent`** | Every detected SoD conflict and its resolution. Central to SOX 404 evidence. **History table required** (A1.2). |
| `leastAccessExceptions` | **`evidence_persistent`** | Documented exceptions to the least-privilege analysis. Auditors review these to confirm over-provisioning was intentionally approved. |
| `permissionGaps` | **`ambiguous`** | Gap analysis results (users losing access post-migration). Operationally important, but whether auditors need to query these post-engagement depends on the review scope. Conservative: `evidence_persistent`. |
| `userGapReviews` | **`ambiguous`** | Review decisions on permission gaps. Same reasoning as `permissionGaps`. |

### Releases & Workflow

| Table | Classification | Rationale |
|-------|---------------|-----------|
| `releases` | **`ambiguous`** | A release/wave is a scope container. It frames the audit (e.g., "Wave 1 go-live 2026-06-01"). Auditors reference it for context. Strong case for `evidence_persistent` at the metadata level (name, date, status) even if the operational rows are retired. |
| `workstreamItems` | `engagement_bounded` | Internal project management rows. No post-engagement audit value. |
| `releaseUsers` | `engagement_bounded` | Scoping table for which users are in-scope per release. Useful context but not a primary audit artifact. |
| `releaseOrgUnits` | `engagement_bounded` | Same. |
| `releaseSourceRoles` | `engagement_bounded` | Same. |
| `releaseTargetRoles` | `engagement_bounded` | Same. |
| `releaseSodRules` | `engagement_bounded` | Same. |
| `appUserReleases` | `engagement_bounded` | Which app operators can see which releases. Operational, not evidence. |
| `workAssignments` | `engagement_bounded` | Mapper/approver scope assignments. Operational. |

### Audit & Compliance Infrastructure

| Table | Classification | Rationale |
|-------|---------------|-----------|
| `auditLog` | **`evidence_persistent`** | The primary audit record. Append-only by design (QW.2 trigger). Must be retained for the full compliance window. Non-negotiable. |
| `evidencePackageRuns` | **`evidence_persistent`** | Records of every evidence package generated, with hash (A1.1). Auditors may ask "when was this package generated and by whom?" Rows are cheap and must be retained. |
| `personaConfirmations` | **`ambiguous`** | Records that a human confirmed an AI-generated persona was correct. Could be read as an acceptance signature — audit value is plausible. If confirmation is treated as an approval action, this is `evidence_persistent`. Otherwise `engagement_bounded`. |
| `mappingFeedback` | **`ambiguous`** | Accept/reject feedback on AI mapping suggestions. Primarily a training signal (engagement_bounded), but each feedback row documents a human override decision — arguably audit-relevant. **Trade-off:** if feedback is used as override justification ("AI suggested X, human chose Y"), it becomes `evidence_persistent`. |

### SOD Workspace & Security Operations

| Table | Classification | Rationale |
|-------|---------------|-----------|
| `securityWorkItems` | `engagement_bounded` | Triage tasks in the compliance/security workspace. Operational workflow, not the evidence itself. The resolution outcome is captured in `sodConflicts`. |

### Operational / Support Infrastructure

| Table | Classification | Rationale |
|-------|---------------|-----------|
| `notifications` | `engagement_bounded` | In-app notifications. No post-engagement value. |
| `processingJobs` | `engagement_bounded` | Background job status records. Operational telemetry only. |
| `reviewLinks` | `engagement_bounded` | Time-limited external review tokens. Expires by design. |
| `rateLimitEntries` | `engagement_bounded` | Transient rate-limit counters. No retention value. |
| `webhookEndpoints` | `engagement_bounded` | Customer-configured webhook destinations. Operational configuration. |
| `webhookDeliveries` | `engagement_bounded` | Delivery attempt log. Useful for debugging, no compliance value. |
| `scheduledExports` | `engagement_bounded` | Export schedule config. Operational. |
| `incidents` | `engagement_bounded` | Internal platform incidents (not customer security incidents). Operational. |
| `chatConversations` | `engagement_bounded` | Lumen AI chat history. User convenience feature, no audit value. |
| `ssoConfigurations` | `engagement_bounded` | SAML/SSO provider config. Operational IT config. |
| `demoLeads` | `engagement_bounded` | Sales lead capture from the demo gate. Not product data. |
| `provisioningRequests` | `engagement_bounded` | Customer purchase provisioning records (intake form submissions). Operational/sales, not product evidence. |

---

## Summary Counts

| Classification | Count |
|----------------|-------|
| `evidence_persistent` | 14 |
| `engagement_bounded` | 34 |
| `ambiguous` | 9 |

**Total:** 57 tables

---

## Ambiguous Cases — Trade-off Articulation

### organizations (tombstone vs. full record)
**Decision needed:** Can auditors tolerate a stub org record (name + ID only), or do they need full org configuration? If the latter, the full row must be retained. If the former, a lightweight tombstone satisfies referential integrity without retaining operational config.

### personas (snapshot vs. live)
**Decision needed:** Does the artifact-continuity SKU include live persona querying, or only the snapshot of personas-at-approval? If the former, the live `personas` table is `evidence_persistent`. If the latter, the history table created in A1.2 is the durable artifact and the live table can be retired.

### releases (metadata vs. full record)
**Decision needed:** Likely only the release name, go-live date, and status need to persist. A materialized JSON snapshot in the evidence package (already built) may be sufficient, making the live `releases` rows `engagement_bounded` with the snapshot serving as the `evidence_persistent` artifact.

### permissionGaps / userGapReviews
**Decision needed:** SOX 404 auditors typically want to see that over-provisioning was identified and addressed. If the exception records in `leastAccessExceptions` cover this, the raw gap rows can be `engagement_bounded`. If auditors need the full gap list, they are `evidence_persistent`.

### personaConfirmations
**Decision needed:** If confirmation is the acceptance gate for "AI output reviewed by human," this is `evidence_persistent`. If it is only a UX affordance (dismiss the AI result screen), it is `engagement_bounded`. Recommend treating it as the former.

### mappingFeedback
**Decision needed:** If Provisum markets that every AI-suggested mapping was reviewed by a human, the feedback rows are the evidence for that claim. That would make them `evidence_persistent`. Recommend classifying as `evidence_persistent` and retaining accordingly.

---

## Implications for Phase A2 (Schema Split)

The 14 `evidence_persistent` tables need to remain in the primary database under the retention policy regardless of the artifact-continuity SKU chosen. The 34 `engagement_bounded` tables are candidates for migration to a cheaper storage tier (read-only Postgres snapshot, S3-backed archive, or simply soft-deletion with data export).

The 9 `ambiguous` cases need founder decisions before Phase A2 schema-split implementation. See also **Founder Decision 1.1** in `docs/technical/CLAUDE_CODE_HANDOFF.md` Section 5.

History tables created in Sprint 1 (A1.2) target:
- `userPersonaAssignments` → `user_persona_assignments_history`
- `personaTargetRoleMappings` → `persona_target_role_mappings_history`
- `sodConflicts` → `sod_conflicts_history`

These are the three highest-priority evidence-persistent tables where point-in-time state is needed for audit reproducibility.
