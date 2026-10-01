import type { Express } from "express";
import { type TierKey } from "./config/registry.js";
import type { IntelligentRouter } from "./services/router.js";
export interface ProxyOptions {
    /** OpenRouter API base, e.g. https://openrouter.ai/api/v1 */
    upstreamUrl?: string;
    /** Used when the client does not send its own OpenRouter key. */
    apiKey?: string;
    /** Model for each tier. */
    models?: Record<TierKey, string>;
}
/**
 * Adds the endpoints coding tools talk to:
 *   POST /v1/chat/completions  OpenAI format  (Copilot, Devin, Cursor, Continue, Aider, ...)
 *   POST /v1/messages          Anthropic format (Claude Code)
 *   GET  /v1/models
 * Each request is routed to a tier, then forwarded to OpenRouter. Streaming is passed straight through.
 */
export declare function mountProxy(app: Express, router: IntelligentRouter, opts?: ProxyOptions): void;
/** Text of the last user message. Handles plain strings and content-part arrays (OpenAI and Anthropic). */
export declare function lastUserText(messages: any[]): string;
