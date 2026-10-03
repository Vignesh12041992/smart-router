export interface Turn {
    prompt: string;
    reply: string;
    tier: string;
    model: string;
}
/** What is kept per conversation: a running summary of older turns, plus the recent turns word for word. */
export interface SessionState {
    summary: string;
    turns: Turn[];
    /** Set once the client relies on memory (sends new prompts without the earlier turns). */
    usesMemory?: boolean;
}
/** Where session state is kept. */
export interface MemoryStore {
    readonly kind: string;
    load(sessionId: string): Promise<SessionState | undefined>;
    save(sessionId: string, state: SessionState): Promise<void>;
}
/** Calls a small, cheap model. Built per request so it reuses that request's own login or key. */
export type Summarizer = (system: string, user: string) => Promise<string>;
/** What a request is handed: the summary of older turns and the recent turns. */
export interface Recalled {
    summary: string;
    turns: Turn[];
}
/**
 * Remembers each conversation, so when smart-router switches models mid-conversation the new model
 * is handed the context. Short conversations are handed over word for word. Once they grow past the
 * token budget, older turns are folded into a running summary written by the cheap micro-tier model,
 * in the background, after the reply has been sent.
 */
export declare class ConversationMemory {
    readonly store: MemoryStore;
    /** ~4 characters per token. 70% of the budget for recent turns, the rest for the summary. */
    private recentChars;
    private summaryWords;
    private queues;
    constructor(store: MemoryStore, opts?: {
        tokens?: number;
    });
    get kind(): string;
    /** Runs one change to a session at a time, so saves and summaries never overwrite each other. */
    private queued;
    /** The context to hand a request that carries no history of its own, kept within the token budget. */
    recall(sessionId: string): Promise<Recalled>;
    /** Saves a finished turn. If the session has grown past the budget, folds older turns into the summary. */
    remember(sessionId: string, turn: Turn, summarize?: Summarizer): Promise<void>;
    private instructions;
    private summaryInput;
}
/** Built-in store, inside the smart-router process. Idle sessions are dropped; so are the oldest past maxSessions. */
export declare class LocalStore implements MemoryStore {
    private opts;
    readonly kind = "local";
    private sessions;
    constructor(opts?: {
        maxSessions?: number;
        idleMs?: number;
    });
    load(sessionId: string): Promise<SessionState | undefined>;
    save(sessionId: string, state: SessionState): Promise<void>;
}
/**
 * Optional: keep memory in an OmniRoute server (https://github.com/diegosouzapw/OmniRoute) instead,
 * so several smart-router processes share it. Each session is one entry.
 *
 * OMNIROUTE_URL      e.g. http://localhost:20128
 * OMNIROUTE_API_KEY  only needed when OmniRoute has auth enabled (needs the manage scope)
 */
export declare class OmniRouteStore implements MemoryStore {
    private baseUrl;
    private apiKey?;
    readonly kind = "omniroute";
    constructor(baseUrl: string, apiKey?: string | undefined);
    private headers;
    load(sessionId: string): Promise<SessionState | undefined>;
    save(sessionId: string, state: SessionState): Promise<void>;
}
/**
 * Memory is on by default and lives inside smart-router.
 * SMART_ROUTER_MEMORY=off         turns it off
 * SMART_ROUTER_MEMORY_TOKENS=2000 most tokens of earlier context handed to a request
 * OMNIROUTE_URL                   optional: keep it in an OmniRoute server
 */
export declare function memoryFromEnv(env?: NodeJS.ProcessEnv): ConversationMemory | undefined;
/** Earlier context as user/assistant messages. Works for both OpenAI and Anthropic formats. */
export declare function historyMessages({ summary, turns }: Recalled): {
    role: "user" | "assistant";
    content: string;
}[];
/** Earlier context as plain text, for single-prompt APIs like Ollama's /api/generate. */
export declare function historyText({ summary, turns }: Recalled): string;
/** Pulls the assistant text out of a raw upstream response: SSE stream or plain JSON, OpenAI or Anthropic. */
export declare function replyText(raw: string): string;
