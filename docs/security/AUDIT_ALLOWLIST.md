# Dependency Audit Allowlist

`pnpm audit --audit-level=high` runs in CI (`.github/workflows/ci.yml`, `security-scan` job).
Advisories that cannot be patched without violating an architecture decision, or that are
not exploitable in this project's deployment model, are allowlisted in
`package.json` under `pnpm.auditConfig.ignoreGhsas`. Every entry is justified here.

**Review cadence:** revisit on every dependency bump and at minimum quarterly. When an
allowlisted advisory becomes patchable (e.g. the Next.js major upgrade), remove the entry.

## Patched (not allowlisted)

Resolved via `pnpm.overrides` / direct bump — no suppression:

| Package | Advisory | Fix |
|---------|----------|-----|
| `drizzle-orm` | GHSA-gpj5-g38j-94v9 | bumped direct dep to `^0.45.2` |
| `glob` (via eslint-config-next) | GHSA-5j98-mcp5-4vw2 | override `>=10.5.0` |
| `fast-uri` (via @sentry/nextjs) | GHSA-q3j6-qgpj-74h6, GHSA-v39h-62p7-jpjc | override `>=3.1.2` |
| `path-to-regexp` (via shadcn>MCP sdk>express) | GHSA-j3q9-mxjg-w52f | override `>=8.4.0` |
| `tmp` (via exceljs) | GHSA-ph9p-34f9-6g65 (path traversal) | override `>=0.2.6` (added 2026-05-28) |

## Allowlisted

### Next.js — 5 advisories (blocked by the Next-14 architecture pin)

| GHSA | Summary | Patched in |
|------|---------|-----------|
| GHSA-h25m-26qc-wcjf | RSC HTTP request deserialization DoS | >=15.0.8 |
| GHSA-q4gf-8mx6-v5v3 | (next) | >=15.5.15 |
| GHSA-8h8q-6873-q5fj | (next) | >=15.5.16 |
| GHSA-c4j6-fc7j-m34r | (next) | >=15.5.16 |
| GHSA-36qx-fr4f-26g5 | (next) | >=15.5.16 |

**Justification:** all require Next.js 15.x. Provisum is deliberately pinned to Next.js 14
(see CLAUDE.md "Critical: Framework version" — synchronous `cookies()`/`headers()`/`params`,
`middleware.ts` not `proxy.ts`). Upgrading to Next 15 is a tracked, deferred migration, not a
patch. **Remove these entries when the Next 15 upgrade lands.** Tracked in MS bug #103.

### Vite — 2 advisories (dev-only, not exploitable here)

| GHSA | Summary | Patched in |
|------|---------|-----------|
| GHSA-v2wj-q39q-566r | Vite dev server `server.fs.deny` bypass | >=8.0.5 |
| GHSA-p9ff-h696-f583 | Vite dev server arbitrary file read via WebSocket | >=8.0.5 |

**Justification:** `vite` is a transitive **dev-only** dependency of `vitest` (test engine) and
`@vitejs/plugin-react`. It is never bundled into the production app and the project never runs
the Vite dev server (it uses `next dev`). Both advisories are exploitable only against an exposed
Vite dev server, which does not exist in this project's runtime. `vitest@4.1.2` resolves `vite@8.0.3`
and a `pnpm` override to `>=8.0.5` does not take effect through vitest's resolution; forcing it is
not worth the risk to the test toolchain for a non-exploitable advisory. **Re-evaluate on the next
`vitest` major upgrade.**
