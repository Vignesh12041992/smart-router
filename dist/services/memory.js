import { createHash } from "crypto";
import { normalizeUrl } from "../config/registry.js";
const RECALL_TURNS = 6;
const CLIP_CHARS = 1500;
const clip = (s) => (s.length > CLIP_CHARS ? s.slice(0, CLIP_CHARS) + "..." : s);
/**
 * Conversation memory stored in an OmniRoute server (https://github.com/diegosouzapw/OmniRoute).
 * Every routed turn is saved under a session id, so the next prompt can be given the earlier
 * turns even when a different model answers it. Failures never block routing.
 *
 * OMNIROUTE_URL      e.g. http://localhost:20128   (memory is off when unset)
 * OMNIROUTE_API_KEY  only needed when OmniRoute has auth enabled (needs the manage scope)
 */
export class OmniRouteMemory {
    baseUrl;
    apiKey;
    constructor(baseUrl, apiKey) {
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
    }
    static fromEnv(env = process.env) {
        return env.OMNIROUTE_URL ? new OmniRouteMemory(normalizeUrl(env.OMNIROUTE_URL), env.OMNIROUTE_API_KEY) : undefined;
    }
    headers() {
        const h = { "Content-Type": "application/json" };
        if (this.apiKey)
            h.Authorization = `Bearer ${this.apiKey}`;
        return h;
    }
    /** Earlier turns of a session, oldest first, as text. Empty string when there are none. */
    async recall(sessionId) {
        try {
            const url = `${this.baseUrl}/api/memory?sessionId=${encodeURIComponent(sessionId)}&limit=${RECALL_TURNS}`;
            const res = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(2000) });
            if (!res.ok)
                return "";
            const { data = [] } = (await res.json());
            // OmniRoute lists newest first.
            return data.reverse().map(m => `[${m.metadata?.tier} / ${m.metadata?.model}]\n${m.content}`).join("\n\n");
        }
        catch {
            return "";
        }
    }
    async remember(sessionId, t) {
        try {
            await fetch(`${this.baseUrl}/api/memory`, {
                method: "POST",
                headers: this.headers(),
                signal: AbortSignal.timeout(2000),
                body: JSON.stringify({
                    // OmniRoute upserts on "key", so the key is unique per session + prompt. A tool loop that
                    // repeats the same prompt updates one entry instead of adding duplicates.
                    key: `${sessionId}:${createHash("sha1").update(t.prompt).digest("hex").slice(0, 12)}`,
                    type: "episodic",
                    sessionId,
                    content: `User: ${clip(t.prompt)}\nAssistant: ${clip(t.reply)}`,
                    metadata: { tier: t.tier, model: t.model }
                })
            });
        }
        catch {
            /* memory is best effort */
        }
    }
}
export function contextBlock(history) {
    return `Earlier turns of this conversation (some were answered by different models). Use them as context:\n\n${history}`;
}
/** Pulls the assistant text out of a raw upstream response: SSE stream or plain JSON, OpenAI or Anthropic. */
export function replyText(raw) {
    if (raw.includes("data:")) {
        let out = "";
        for (const line of raw.split("\n")) {
            if (!line.startsWith("data:"))
                continue;
            const d = line.slice(5).trim();
            if (!d || d === "[DONE]")
                continue;
            try {
                const j = JSON.parse(d);
                out += j.delta?.text ?? j.choices?.[0]?.delta?.content ?? "";
            }
            catch { /* skip partial line */ }
        }
        return out;
    }
    try {
        const j = JSON.parse(raw);
        return j.choices?.[0]?.message?.content ?? (j.content ?? []).map((b) => b.text ?? "").join("");
    }
    catch {
        return "";
    }
}
