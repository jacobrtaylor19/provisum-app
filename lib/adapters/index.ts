/**
 * Adapter Registry
 *
 * Returns the appropriate TargetSystemAdapter instance based on the
 * configured adapter type. Real adapters (sap_s4hana, workday, etc.) are
 * currently stubbed with MockSapAdapter — replace each entry when the
 * real adapter implementation lands (blocked on client environment access).
 */

import type { TargetSystemAdapter } from "./target-system-adapter";
import { MockSapAdapter } from "./mock-sap-adapter";
import type { CredentialPayload } from "./credentials";

// Factory map: adapter type → constructor.
// All real-adapter entries currently return MockSapAdapter until the
// real implementations are built (see PRD_Target_System_Design.md).
type AdapterFactory = (config: CredentialPayload) => TargetSystemAdapter;

const ADAPTER_TYPES: Record<string, AdapterFactory> = {
  mock:           (_config) => new MockSapAdapter(),
  sap_s4hana:    (_config) => new MockSapAdapter(), // TODO: replace with SapS4HanaAdapter
  workday:        (_config) => new MockSapAdapter(), // TODO: replace with WorkdayAdapter
  oracle_fusion:  (_config) => new MockSapAdapter(), // TODO: replace with OracleFusionAdapter
  servicenow:    (_config) => new MockSapAdapter(), // TODO: replace with ServiceNowAdapter
};

/**
 * Get a target system adapter by type.
 *
 * @param type   - Adapter type (e.g., "sap_s4hana", "workday")
 * @param config - Decrypted CredentialPayload from the vault
 * @returns The configured adapter instance
 * @throws If the adapter type is not recognised at all
 */
export function getAdapter(
  type: string,
  config: CredentialPayload = {},
): TargetSystemAdapter {
  const factory = ADAPTER_TYPES[type];
  if (!factory) {
    const supported = Object.keys(ADAPTER_TYPES).join(", ");
    throw new Error(
      `Unsupported adapter type "${type}". Supported types: ${supported}`,
    );
  }
  return factory(config);
}

export type { TargetSystemAdapter, SecurityDesignSnapshot, SecurityDesignChange, TargetRoleSnapshot } from "./target-system-adapter";
