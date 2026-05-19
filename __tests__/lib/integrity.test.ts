import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Mock the DB module. vi.mock factories are hoisted, so all mock setup must
// use vi.fn() inline — no outer-variable references allowed inside the factory.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("@/db", () => {
  const mockWhere = vi.fn().mockResolvedValue([]);
  const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });
  return { db: { update: mockUpdate } };
});

vi.mock("@/db/schema", () => ({
  evidencePackageRuns: { id: "id" },
}));

// Import AFTER mocks are registered
import { emitIntegrityHash, computeHash } from "@/lib/exports/integrity";
import { db } from "@/db";

// ─────────────────────────────────────────────────────────────────────────────

function knownHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

describe("computeHash", () => {
  it("returns a 64-char hex string for a known input", () => {
    expect(computeHash("hello")).toBe(knownHash("hello"));
    expect(computeHash("hello")).toHaveLength(64);
    expect(computeHash("hello")).toMatch(/^[0-9a-f]+$/);
  });

  it("accepts Buffer payloads", () => {
    const buf = Buffer.from("hello");
    expect(computeHash(buf)).toBe(computeHash("hello"));
  });

  it("produces different hashes for different inputs", () => {
    expect(computeHash("foo")).not.toBe(computeHash("bar"));
  });

  it("is deterministic", () => {
    expect(computeHash("same")).toBe(computeHash("same"));
  });
});

describe("emitIntegrityHash", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns hash, algorithm='sha256', and emittedAt Date", async () => {
    const result = await emitIntegrityHash("test payload");
    expect(result.hash).toBe(knownHash("test payload"));
    expect(result.algorithm).toBe("sha256");
    expect(result.emittedAt).toBeInstanceOf(Date);
  });

  it("does NOT call db.update when runRecordId is omitted", async () => {
    await emitIntegrityHash("no-persist");
    expect((db as { update: ReturnType<typeof vi.fn> }).update).not.toHaveBeenCalled();
  });

  it("calls db.update when runRecordId is provided", async () => {
    const result = await emitIntegrityHash("persist me", 42);
    const mockUpdate = (db as { update: ReturnType<typeof vi.fn> }).update;
    expect(mockUpdate).toHaveBeenCalledOnce();
    // The set call should include the computed hash
    const mockSet = mockUpdate.mock.results[0].value.set as ReturnType<typeof vi.fn>;
    expect(mockSet).toHaveBeenCalledWith({ hash: result.hash });
  });

  it("still returns hash even if DB write throws", async () => {
    // Make the where call reject on the next invocation
    const mockUpdate = (db as { update: ReturnType<typeof vi.fn> }).update;
    const mockSet = vi.fn().mockReturnValue({
      where: vi.fn().mockRejectedValueOnce(new Error("DB down")),
    });
    mockUpdate.mockReturnValueOnce({ set: mockSet });

    const result = await emitIntegrityHash("resilient", 99);
    expect(result.hash).toBe(knownHash("resilient"));
    expect(result.emittedAt).toBeInstanceOf(Date);
  });

  it("works with Buffer payloads", async () => {
    const buf = Buffer.from("buffer content");
    const result = await emitIntegrityHash(buf);
    expect(result.hash).toBe(computeHash(buf));
  });
});
