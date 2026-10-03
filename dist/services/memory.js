import { createHash } from "crypto";
import { normalizeUrl } from "../config/registry.js";
const RECALL_TURNS = 10;
const CLIP_CHARS = 8000;
const clip = (s) => (s.length > CLIP_CHARS ? s.slice(0, CLIP_CHARS) + "..." : s);
/**
 * Built-in memory, kept inside the smart-router process. On by default, nothing to set up.
 * Old sessions are dropped after `idleMs` without activity, and the oldest are dropped past `maxSessions`.
 */
export class LocalMemory {
    opts;
    kind = "local";
    sessions = new Map();
    constructor(opts = {}) {
        this.opts = opts;
    }
    async recall(sessionId) {
        const s = this.sessions.get(sessionId);
        if (!s)
            return [];
        if (Date.now() - s.seen > (this.opts.idleMs ?? 6 * 3600_000)) {
            this.sessions.delete(sessionId);
            return [];
        }
        return s.turns.slice(-RECALL_TURNS);
    }
    async remember(sessionId, t) {
        const turn = { ...t, prompt: clip(t.prompt), reply: clip(t.reply) };
        const s = this.sessions.get(sessionId) ?? { turns: [], seen: 0 };
        // A tool loop resends the same prompt many times; keep one entry for it.
        if (s.turns.at(-1)?.prompt === turn.prompt)
            s.turns[s.turns.length - 1] = turn;
        else
            s.turns.push(turn);
        if (s.turns.length > (this.opts.maxTurns ?? 50))
            s.turns.shift();
        s.seen = Date.now();
        this.sessions.delete(sessionId); // re-insert so the Map stays ordered by last use
        this.sessions.set(sessionId, s);
        const max = this.opts.maxSessions ?? 500;
        while (this.sessions.size > max)
            this.sessions.delete(this.sessions.keys().next().value);
    }
}
/**
 * Optional: keep memory in an OmniRoute server (https://github.com/diegosouzapw/OmniRoute) instead,
 * so it is shared between several smart-router processes. Failures never block routing.
 *
 * OMNIROUTE_URL      e.g. http://localhost:20128
 * OMNIROUTE_API_KEY  only needed when OmniRoute has auth enabled (needs the manage scope)
 */
export class OmniRouteMemory {
    baseUrl;
    apiKey;
    kind = "omniroute";
    constructor(baseUrl, apiKey) {
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
    }
    headers() {
        const h = { "Content-Type": "application/json" };
        if (this.apiKey)
            h.Authorization = `Bearer ${this.apiKey}`;
        return h;
    }
    async recall(sessionId) {
        try {
            const url = `${this.baseUrl}/api/memory?sessionId=${encodeURIComponent(sessionId)}&limit=${RECALL_TURNS}`;
            const res = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(2000) });
            if (!res.ok)
                return [];
            const { data = [] } = (await res.json());
            // OmniRoute lists newest first.
            return data.reverse().map(m => ({
                prompt: m.metadata?.prompt ?? "",
                reply: m.metadata?.reply ?? String(m.content ?? ""),
                tier: m.metadata?.tier ?? "",
                model: m.metadata?.model ?? ""
            }));
        }
        catch {
            return [];
        }
    }
    async remember(sessionId, t) {
        const prompt = clip(t.prompt);
        const reply = clip(t.reply);
        try {
            await fetch(`${this.baseUrl}/api/memory`, {
                method: "POST",
                headers: this.headers(),
                signal: AbortSignal.timeout(2000),
                body: JSON.stringify({
                    // OmniRoute upserts on "key", so a tool loop that repeats a prompt updates one entry.
                    key: `${sessionId}:${createHash("sha1").update(t.prompt).digest("hex").slice(0, 12)}`,
                    type: "episodic",
                    sessionId,
                    content: `User: ${prompt}\nAssistant: ${reply}`,
                    metadata: { tier: t.tier, model: t.model, prompt, reply }
                })
            });
        }
        catch {
            /* memory is best effort */
        }
    }
}
/**
 * Memory is on by default and lives inside smart-router.
 * SMART_ROUTER_MEMORY=off turns it off. OMNIROUTE_URL moves it to an OmniRoute server.
 */
export function memoryFromEnv(env = process.env) {
    if (/^(off|false|0|no)$/i.test(env.SMART_ROUTER_MEMORY ?? ""))
        return undefined;
    if (env.OMNIROUTE_URL)
        return new OmniRouteMemory(normalizeUrl(env.OMNIROUTE_URL), env.OMNIROUTE_API_KEY);
    return new LocalMemory();
}
/** Earlier turns as user/assistant messages. Works for both OpenAI and Anthropic formats. */
export function historyMessages(turns) {
    return turns
        .filter(t => t.prompt && t.reply)
        .flatMap(t => [{ role: "user", content: t.prompt }, { role: "assistant", content: t.reply }]);
}
/** Earlier turns as plain text, for single-prompt APIs like Ollama's /api/generate. */
export function historyText(turns) {
    return turns.filter(t => t.prompt && t.reply).map(t => `User: ${t.prompt}\nAssistant: ${t.reply}`).join("\n\n");
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
