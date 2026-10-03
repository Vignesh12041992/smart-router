export interface Turn {
    prompt: string;
    reply: string;
    tier: string;
    model: string;
}
/**
 * Conversation memory stored in an OmniRoute server (https://github.com/diegosouzapw/OmniRoute).
 * Every routed turn is saved under a session id, so the next prompt can be given the earlier
 * turns even when a different model answers it. Failures never block routing.
 *
 * OMNIROUTE_URL      e.g. http://localhost:20128   (memory is off when unset)
 * OMNIROUTE_API_KEY  only needed when OmniRoute has auth enabled (needs the manage scope)
 */
export declare class OmniRouteMemory {
    private baseUrl;
    private apiKey?;
    constructor(baseUrl: string, apiKey?: string | undefined);
    static fromEnv(env?: NodeJS.ProcessEnv): OmniRouteMemory | undefined;
    private headers;
    /** Earlier turns of a session, oldest first, as text. Empty string when there are none. */
    recall(sessionId: string): Promise<string>;
    remember(sessionId: string, t: Turn): Promise<void>;
}
export declare function contextBlock(history: string): string;
/** Pulls the assistant text out of a raw upstream response: SSE stream or plain JSON, OpenAI or Anthropic. */
export declare function replyText(raw: string): string;
