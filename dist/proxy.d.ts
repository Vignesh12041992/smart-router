import type { Express } from "express";
import { type TierKey } from "./config/registry.js";
import type { IntelligentRouter } from "./services/router.js";
import { type ConversationMemory } from "./services/memory.js";
/**
 * Where Claude Code requests (/v1/messages) go:
 *   "anthropic"  - straight to Anthropic with the tool's OWN login. No extra key. (default)
 *   "openrouter" - to OpenRouter with an OpenRouter key.
 */
export type ClaudeProvider = "anthropic" | "openrouter";
export interface ProxyOptions {
    claudeProvider?: ClaudeProvider;
    /** Anthropic API base, e.g. https://api.anthropic.com/v1 */
    anthropicUrl?: string;
    /** Claude model for each tier (anthropic provider). */
    claudeModels?: Record<TierKey, string>;
    /** OpenRouter API base, e.g. https://openrouter.ai/api/v1 */
    upstreamUrl?: string;
    /** Used when the client does not send its own OpenRouter key. */
    apiKey?: string;
    /** Model for each tier. */
    models?: Record<TierKey, string>;
    /**
     * Conversation memory, so a model switch mid-conversation keeps the context.
     * Defaults to the built-in store (see memoryFromEnv). false turns it off.
     */
    memory?: ConversationMemory | false;
}
/**
 * Adds the endpoints coding tools talk to:
 *   POST /v1/chat/completions  OpenAI format  (Copilot, Devin, Cursor, Continue, Aider, ...)
 *   POST /v1/messages          Anthropic format (Claude Code) - uses Claude Code's own login by default
 *   GET  /v1/models
 * Each request is routed to a tier, then forwarded to OpenRouter. Streaming is passed straight through.
 */
export declare function mountProxy(app: Express, router: IntelligentRouter, opts?: ProxyOptions): void;
/** Text of the last user message. Handles plain strings and content-part arrays (OpenAI and Anthropic). */
export declare function lastUserText(messages: any[]): string;
