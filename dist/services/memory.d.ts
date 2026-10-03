export interface Turn {
    prompt: string;
    reply: string;
    tier: string;
    model: string;
}
/**
 * Remembers the turns of each conversation (session), so when smart-router switches to a
 * different model mid-conversation, the new model is handed the earlier turns.
 */
export interface ConversationMemory {
    readonly kind: string;
    /** Earlier turns of a session, oldest first. Empty when there are none. */
    recall(sessionId: string): Promise<Turn[]>;
    remember(sessionId: string, turn: Turn): Promise<void>;
}
/**
 * Built-in memory, kept inside the smart-router process. On by default, nothing to set up.
 * Old sessions are dropped after `idleMs` without activity, and the oldest are dropped past `maxSessions`.
 */
export declare class LocalMemory implements ConversationMemory {
    private opts;
    readonly kind = "local";
    private sessions;
    constructor(opts?: {
        maxTurns?: number;
        maxSessions?: number;
        idleMs?: number;
    });
    recall(sessionId: string): Promise<Turn[]>;
    remember(sessionId: string, t: Turn): Promise<void>;
}
/**
 * Optional: keep memory in an OmniRoute server (https://github.com/diegosouzapw/OmniRoute) instead,
 * so it is shared between several smart-router processes. Failures never block routing.
 *
 * OMNIROUTE_URL      e.g. http://localhost:20128
 * OMNIROUTE_API_KEY  only needed when OmniRoute has auth enabled (needs the manage scope)
 */
export declare class OmniRouteMemory implements ConversationMemory {
    private baseUrl;
    private apiKey?;
    readonly kind = "omniroute";
    constructor(baseUrl: string, apiKey?: string | undefined);
    private headers;
    recall(sessionId: string): Promise<Turn[]>;
    remember(sessionId: string, t: Turn): Promise<void>;
}
/**
 * Memory is on by default and lives inside smart-router.
 * SMART_ROUTER_MEMORY=off turns it off. OMNIROUTE_URL moves it to an OmniRoute server.
 */
export declare function memoryFromEnv(env?: NodeJS.ProcessEnv): ConversationMemory | undefined;
/** Earlier turns as user/assistant messages. Works for both OpenAI and Anthropic formats. */
export declare function historyMessages(turns: Turn[]): {
    role: "user" | "assistant";
    content: string;
}[];
/** Earlier turns as plain text, for single-prompt APIs like Ollama's /api/generate. */
export declare function historyText(turns: Turn[]): string;
/** Pulls the assistant text out of a raw upstream response: SSE stream or plain JSON, OpenAI or Anthropic. */
export declare function replyText(raw: string): string;
