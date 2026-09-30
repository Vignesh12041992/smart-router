import { type TierKey } from "../config/registry.js";
/**
 * "laya"    - use the Laya model (downloads ~1.7 GB on first run).
 * "keyword" - fast offline word matching, no download.
 * "auto"    - try Laya, fall back to keyword if it cannot load.
 */
export type Engine = "auto" | "laya" | "keyword";
export interface RouteDecision {
    tier: TierKey;
    modelName: string;
    complexityScore: string;
    confidence: string;
    engine: "laya" | "keyword";
    cached: boolean;
}
export interface RouterOptions {
    engine?: Engine;
    ollamaUrl?: string;
    /** Skip asking Ollama for installed models (useful for tests). */
    models?: string[];
    /** Print progress messages (goes to stderr so stdout stays clean). */
    log?: (msg: string) => void;
    /** Inject a Laya-like object (used by tests). */
    laya?: LayaLike;
}
export interface LayaLike {
    systemOne(state: unknown, questions: any): Promise<any>;
    close?(): Promise<void>;
}
export declare class IntelligentRouter {
    private opts;
    readonly ollamaUrl: string;
    private engine;
    private laya?;
    private cache;
    private log;
    ollamaModels: string[];
    ollamaOnline: boolean;
    constructor(opts?: RouterOptions);
    get activeEngine(): "laya" | "keyword";
    init(): Promise<void>;
    refreshModels(): Promise<void>;
    processRequest(prompt: string): Promise<RouteDecision>;
    close(): Promise<void>;
    private classifyWithLaya;
    /** Picks the best installed Ollama model for a tier. */
    matchModel(tierKey: TierKey): string;
}
/** Offline router: counts hint words per tier and estimates complexity from length and keywords. */
export declare function classifyWithKeywords(prompt: string): {
    tier: TierKey;
    score: number;
    conf: number;
};
