import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Mock the DB module (vi.mock factories are hoisted — all setup must be inline)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("@/db", () => {
  const mockReturning = vi.fn().mockResolvedValue([{ id: 42 }]);
  const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

  const mockWhere = vi.fn().mockResolvedValue([
    {
      id: 42,
      organizationId: 1,
      adapterType: "sap_s4hana",
      name: "Prod SAP",
      isActive: true,
      lastTestedAt: null,
      lastTestStatus: null,
      createdAt: "2026-05-19T00:00:00.000Z",
      updatedAt: "2026-05-19T00:00:00.000Z",
    },
  ]);
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

  const mockUpdateWhere = vi.fn().mockResolvedValue([]);
  const mockSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

  const mockDeleteWhere = vi.fn().mockResolvedValue([]);
  const mockDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

  return {
    db: {
      insert: mockInsert,
      select: mockSelect,
      update: mockUpdate,
      delete: mockDelete,
    },
  };
});

vi.mock("@/db/schema", () => ({
  adapterCredentials: {
    id: "id",
    organizationId: "organization_id",
    adapterType: "adapter_type",
    name: "name",
    credentialsEnc: "credentials_enc",
    isActive: "is_active",
    lastTestedAt: "last_tested_at",
    lastTestStatus: "last_test_status",
    createdAt: "created_at",
    updatedAt: "updated_at",
    $inferInsert: {},
  },
}));

// Mock encryption so tests don't need a real ENCRYPTION_KEY
vi.mock("@/lib/encryption", () => ({
  encrypt: (plaintext: string) => `enc:${plaintext}`,
  decrypt: (ciphertext: string) => {
    if (!ciphertext.startsWith("enc:")) throw new Error("Invalid encrypted value");
    return ciphertext.slice(4);
  },
}));

// Import AFTER mocks
import {
  storeCredential,
  listCredentials,
  getCredentialMeta,
  getDecryptedCredentials,
  updateCredential,
  deleteCredential,
  recordTestResult,
} from "@/lib/adapters/credentials";
import { db } from "@/db";

// ─────────────────────────────────────────────────────────────────────────────

const mockDb = db as {
  insert: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();

  // Reset default chain
  const mockReturning = vi.fn().mockResolvedValue([{ id: 42 }]);
  const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
  mockDb.insert.mockReturnValue({ values: mockValues });

  const baseRow = {
    id: 42,
    organizationId: 1,
    adapterType: "sap_s4hana",
    name: "Prod SAP",
    isActive: true,
    lastTestedAt: null,
    lastTestStatus: null,
    createdAt: "2026-05-19T00:00:00.000Z",
    updatedAt: "2026-05-19T00:00:00.000Z",
  };
  const mockWhere = vi.fn().mockResolvedValue([baseRow]);
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  mockDb.select.mockReturnValue({ from: mockFrom });

  const mockUpdateWhere = vi.fn().mockResolvedValue([]);
  const mockSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  mockDb.update.mockReturnValue({ set: mockSet });

  const mockDeleteWhere = vi.fn().mockResolvedValue([]);
  mockDb.delete.mockReturnValue({ where: mockDeleteWhere });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("storeCredential", () => {
  it("encrypts the payload and returns the new record id", async () => {
    const id = await storeCredential(1, "sap_s4hana", "Prod SAP", {
      host: "sap.example.com",
      username: "PROVISUM",
      password: "s3cr3t",
    });

    expect(id).toBe(42);
    expect(mockDb.insert).toHaveBeenCalledOnce();

    // The values call should have received an encrypted string, not the plaintext
    const insertCall = mockDb.insert.mock.results[0].value;
    const valuesArg = insertCall.values.mock.calls[0][0];
    // Encryption mock prefixes with "enc:" — verify the field is the encrypted form, not bare JSON
    expect(valuesArg.credentialsEnc).toBe(
      'enc:{"host":"sap.example.com","username":"PROVISUM","password":"s3cr3t"}',
    );
    // The field must not be the raw plaintext JSON (i.e. encryption was invoked)
    expect(valuesArg.credentialsEnc).toMatch(/^enc:/);
    expect(valuesArg.credentialsEnc).not.toBe('{"host":"sap.example.com","username":"PROVISUM","password":"s3cr3t"}');
  });

  it("stores adapterType and name correctly", async () => {
    await storeCredential(5, "workday", "HR System", { clientId: "abc", clientSecret: "xyz" });
    const insertCall = mockDb.insert.mock.results[0].value;
    const valuesArg = insertCall.values.mock.calls[0][0];
    expect(valuesArg.adapterType).toBe("workday");
    expect(valuesArg.name).toBe("HR System");
    expect(valuesArg.organizationId).toBe(5);
  });
});

describe("listCredentials", () => {
  it("returns metadata rows without credentialsEnc", async () => {
    const list = await listCredentials(1);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(42);
    expect(list[0].adapterType).toBe("sap_s4hana");
    // credentialsEnc must not appear
    expect(list[0]).not.toHaveProperty("credentialsEnc");
  });
});

describe("getCredentialMeta", () => {
  it("returns metadata for an existing record", async () => {
    const meta = await getCredentialMeta(42, 1);
    expect(meta).not.toBeNull();
    expect(meta!.id).toBe(42);
    expect(meta!.name).toBe("Prod SAP");
    expect(meta).not.toHaveProperty("credentialsEnc");
  });

  it("returns null when record is not found", async () => {
    const mockWhere = vi.fn().mockResolvedValue([]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    mockDb.select.mockReturnValue({ from: mockFrom });

    const meta = await getCredentialMeta(999, 1);
    expect(meta).toBeNull();
  });
});

describe("getDecryptedCredentials", () => {
  it("decrypts and returns the credential payload", async () => {
    const encRow = {
      credentialsEnc: 'enc:{"host":"sap.example.com","username":"PROVISUM"}',
      organizationId: 1,
    };
    const mockWhere = vi.fn().mockResolvedValue([encRow]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    mockDb.select.mockReturnValue({ from: mockFrom });

    const payload = await getDecryptedCredentials(42, 1);
    expect(payload.host).toBe("sap.example.com");
    expect(payload.username).toBe("PROVISUM");
  });

  it("throws when record not found", async () => {
    const mockWhere = vi.fn().mockResolvedValue([]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    mockDb.select.mockReturnValue({ from: mockFrom });

    await expect(getDecryptedCredentials(999, 1)).rejects.toThrow("not found");
  });
});

describe("updateCredential", () => {
  it("re-encrypts payload when provided", async () => {
    await updateCredential(42, 1, { payload: { password: "new_secret" } });
    const setArg = mockDb.update.mock.results[0].value.set.mock.calls[0][0];
    expect(setArg.credentialsEnc).toBe('enc:{"password":"new_secret"}');
  });

  it("updates name without touching credentialsEnc", async () => {
    await updateCredential(42, 1, { name: "Renamed SAP" });
    const setArg = mockDb.update.mock.results[0].value.set.mock.calls[0][0];
    expect(setArg.name).toBe("Renamed SAP");
    expect(setArg.credentialsEnc).toBeUndefined();
  });

  it("throws when record not found", async () => {
    const mockWhere = vi.fn().mockResolvedValue([]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    mockDb.select.mockReturnValue({ from: mockFrom });

    await expect(updateCredential(999, 1, { name: "X" })).rejects.toThrow("not found");
  });
});

describe("deleteCredential", () => {
  it("returns true when deletion succeeds", async () => {
    const deleted = await deleteCredential(42, 1);
    expect(deleted).toBe(true);
    expect(mockDb.delete).toHaveBeenCalledOnce();
  });

  it("returns false when record not found", async () => {
    const mockWhere = vi.fn().mockResolvedValue([]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    mockDb.select.mockReturnValue({ from: mockFrom });

    const deleted = await deleteCredential(999, 1);
    expect(deleted).toBe(false);
    expect(mockDb.delete).not.toHaveBeenCalled();
  });
});

describe("recordTestResult", () => {
  it("updates lastTestedAt and lastTestStatus on success", async () => {
    await recordTestResult(42, "success");
    const setArg = mockDb.update.mock.results[0].value.set.mock.calls[0][0];
    expect(setArg.lastTestStatus).toBe("success");
    expect(setArg.lastTestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("updates lastTestStatus on failure", async () => {
    await recordTestResult(42, "failed");
    const setArg = mockDb.update.mock.results[0].value.set.mock.calls[0][0];
    expect(setArg.lastTestStatus).toBe("failed");
  });
});
