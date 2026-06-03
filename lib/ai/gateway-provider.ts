/**
 * Vercel AI Gateway provider (Engine PRD §12, §13 — multi-provider routing).
 *
 * Implements the same `AIProvider` contract as the other backends in this file,
 * so existing call sites adopt it by switching `ai.provider = "gateway"` with
 * no code change. Adds:
 *   - cost tracking via tags (PRD §13 cost envelope)
 *   - per-user observability via the `user` field
 *   - automatic failover (set `providerOptions.gateway.order` per call site if desired)
 *   - audit logging at the Vercel platform level
 *
 * Auth: OIDC by default — `vercel env pull` provisions the OIDC token; the AI SDK
 * gateway resolves it automatically. See docs/Vercel AI Gateway docs for setup.
 *
 * Decision (B2 pivot, Jun 2026): OpenAI shut down self-serve fine-tuning. The
 * matcher + reasoning-via-Gateway path is what production uses until the B4
 * flywheel accumulates real corrections — then re-evaluate fine-tuning against
 * the harder training signal.
 */

import { generateText, gateway } from "ai";
import type { AIProvider } from "./provider";

// AI SDK requires JSON-compatible values for providerOptions.
type JsonScalar = string | number | boolean | null;
type JsonValue = JsonScalar | JsonScalar[] | { [k: string]: JsonValue };
type GatewayProviderOpts = { [k: string]: JsonValue };

export interface GatewayProviderOptions {
  /** Default model. Examples: "anthropic/claude-sonnet-4.6", "openai/gpt-5.4". */
  model?: string;
  /** Per-call: stable user id for rate-limit + spend-by-user accounting. */
  user?: string;
  /** Per-call: tags for cost attribution (feature, env, team, etc). */
  tags?: string[];
  /**
   * Provider failover order. If set, the gateway tries providers in order;
   * empty/undefined leaves the gateway's default routing.
   * Example: ["anthropic", "bedrock"] to fall back to Bedrock if Anthropic 503s.
   */
  order?: string[];
}

const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";
const DEFAULT_TAGS = ["env:provisum-runtime"];

export class GatewayProvider implements AIProvider {
  name = "gateway";
  private model: string;
  private user?: string;
  private tags: string[];
  private order?: string[];

  constructor(opts: GatewayProviderOptions = {}) {
    this.model = opts.model || DEFAULT_MODEL;
    this.user = opts.user;
    this.tags = opts.tags?.length ? opts.tags : DEFAULT_TAGS;
    this.order = opts.order;
  }

  async generateText(prompt: string, systemPrompt?: string): Promise<string> {
    const gatewayOpts: GatewayProviderOpts = {
      tags: this.tags,
    };
    if (this.user) gatewayOpts.user = this.user;
    if (this.order && this.order.length > 0) gatewayOpts.order = this.order;

    const result = await generateText({
      model: gateway(this.model),
      ...(systemPrompt ? { system: systemPrompt } : {}),
      prompt,
      providerOptions: { gateway: gatewayOpts },
    });
    return result.text;
  }
}

/**
 * Helper for call sites that want fine-grained gateway controls per-call
 * (different model, user, tags, cache, etc.) without going through the
 * provider abstraction.
 */
export async function gatewayGenerateText(opts: {
  prompt: string;
  system?: string;
  model?: string;
  user?: string;
  tags?: string[];
  order?: string[];
  /** Cache-control header (e.g. "max-age=3600"). */
  cacheControl?: string;
}): Promise<{ text: string; usage?: object }> {
  const gatewayOpts: GatewayProviderOpts = {
    tags: opts.tags ?? DEFAULT_TAGS,
  };
  if (opts.user) gatewayOpts.user = opts.user;
  if (opts.order && opts.order.length > 0) gatewayOpts.order = opts.order;
  if (opts.cacheControl) gatewayOpts.cacheControl = opts.cacheControl;

  const result = await generateText({
    model: gateway(opts.model ?? DEFAULT_MODEL),
    ...(opts.system ? { system: opts.system } : {}),
    prompt: opts.prompt,
    providerOptions: { gateway: gatewayOpts },
  });
  return { text: result.text, usage: result.usage };
}
