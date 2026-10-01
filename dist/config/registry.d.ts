export type TierKey = "micro" | "coder" | "reasoner" | "general";
export interface ModelTier {
    key: TierKey;
    description: string;
    fallbackKeywords: string[];
    /** Words that hint at this tier. Used by the offline keyword engine. */
    hintWords: string[];
}
export declare const DEFAULT_OLLAMA_URL: string;
/** Used when Ollama is not reachable, so routing still returns a sensible model name. */
export declare const DEFAULT_MODELS: string[];
export declare const ROUTING_TIERS: ModelTier[];
export declare function normalizeUrl(url: string): string;
export declare const DEFAULT_OPENROUTER_URL = "https://openrouter.ai/api/v1";
/**
 * Model used for each tier when forwarding to OpenRouter.
 * Override one with an env var, e.g. SMART_ROUTER_CODER_MODEL=qwen/qwen3-coder:free
 */
export declare const DEFAULT_OPENROUTER_MODELS: Record<TierKey, string>;
export declare function openRouterModels(env?: NodeJS.ProcessEnv): Record<TierKey, string>;
