import { normalizeUrl } from "../config/registry.js";
const MAX_TURN_CHARS = 8000;
const clip = (s, n = MAX_TURN_CHARS) => (s.length > n ? s.slice(0, n) + "..." : s);
const turnChars = (t) => t.prompt.length + t.reply.length;
/**
 * Remembers each conversation, so when smart-router switches models mid-conversation the new model
 * is handed the context. Short conversations are handed over word for word. Once they grow past the
 * token budget, older turns are folded into a running summary written by the cheap micro-tier model,
 * in the background, after the reply has been sent.
 */
export class ConversationMemory {
    store;
    /** ~4 characters per token. 70% of the budget for recent turns, the rest for the summary. */
    recentChars;
    summaryWords;
    queues = new Map();
    constructor(store, opts = {}) {
        this.store = store;
        const tokens = opts.tokens ?? 2000;
        this.recentChars = Math.round(tokens * 4 * 0.7);
        this.summaryWords = Math.max(50, Math.round(tokens * 0.3 * 0.75));
    }
    get kind() {
        return this.store.kind;
    }
    /** Runs one change to a session at a time, so saves and summaries never overwrite each other. */
    queued(sessionId, fn) {
        const run = (this.queues.get(sessionId) ?? Promise.resolve()).then(fn, fn);
        const tail = run.catch(() => { });
        this.queues.set(sessionId, tail);
        void tail.then(() => { if (this.queues.get(sessionId) === tail)
            this.queues.delete(sessionId); });
        return run;
    }
    /** The context to hand a request that carries no history of its own, kept within the token budget. */
    async recall(sessionId) {
        let state;
        try {
            state = await this.store.load(sessionId);
        }
        catch {
            return { summary: "", turns: [] };
        }
        if (!state || (!state.summary && !state.turns.length))
            return { summary: "", turns: [] };
        // This client continues a conversation without resending it: from now on, keep it summarized.
        if (!state.usesMemory) {
            void this.queued(sessionId, async () => {
                const s = await this.store.load(sessionId);
                if (s && !s.usesMemory)
                    await this.store.save(sessionId, { ...s, usesMemory: true });
            }).catch(() => { });
        }
        // Newest turns first, until the budget is used. The newest one always goes in, cut to fit if needed.
        const turns = [];
        let used = 0;
        for (let i = state.turns.length - 1; i >= 0; i--) {
            const t = state.turns[i];
            if (turns.length && used + turnChars(t) > this.recentChars)
                break;
            const half = Math.floor(this.recentChars / 2);
            turns.unshift(turns.length ? t : { ...t, prompt: clip(t.prompt, half), reply: clip(t.reply, half) });
            used += turnChars(t);
        }
        return { summary: state.summary, turns };
    }
    /** Saves a finished turn. If the session has grown past the budget, folds older turns into the summary. */
    remember(sessionId, turn, summarize) {
        return this.queued(sessionId, async () => {
            const state = (await this.store.load(sessionId)) ?? { summary: "", turns: [] };
            const t = { ...turn, prompt: clip(turn.prompt), reply: clip(turn.reply) };
            // A tool loop resends the same prompt many times; keep one entry for it.
            if (state.turns.at(-1)?.prompt === t.prompt)
                state.turns[state.turns.length - 1] = t;
            else
                state.turns.push(t);
            state.turns = state.turns.slice(-50);
            await this.store.save(sessionId, state);
            // Only clients that rely on memory need a summary. Claude Code and the like resend everything.
            if (!state.usesMemory || !summarize)
                return;
            let total = state.turns.reduce((n, x) => n + turnChars(x), 0);
            let fold = 0;
            while (total > this.recentChars && state.turns.length - fold > 2)
                total -= turnChars(state.turns[fold++]);
            if (!fold)
                return;
            const summary = (await summarize(this.instructions(), this.summaryInput(state.summary, state.turns.slice(0, fold)))).trim();
            if (!summary)
                return;
            await this.store.save(sessionId, { ...state, summary, turns: state.turns.slice(fold) });
        }).catch(() => { });
    }
    instructions() {
        return [
            "You keep a running summary of a conversation between a user and an AI assistant.",
            "Merge the new turns into the existing summary. Keep what is needed to continue the work:",
            "the user's goals, decisions made, facts and numbers, names, file names, code identifiers,",
            "constraints and preferences, and open questions. Drop greetings and filler.",
            `Write at most ${this.summaryWords} words, as short bullet points. Reply with the summary only.`
        ].join(" ");
    }
    summaryInput(previous, turns) {
        const lines = turns.map(t => `User: ${t.prompt}\nAssistant (${t.model}): ${t.reply}`).join("\n\n");
        return `Existing summary:\n${previous || "(none yet)"}\n\nNew turns:\n${lines}`;
    }
}
/** Built-in store, inside the smart-router process. Idle sessions are dropped; so are the oldest past maxSessions. */
export class LocalStore {
    opts;
    kind = "local";
    sessions = new Map();
    constructor(opts = {}) {
        this.opts = opts;
    }
    async load(sessionId) {
        const s = this.sessions.get(sessionId);
        if (!s)
            return undefined;
        if (Date.now() - s.seen > (this.opts.idleMs ?? 6 * 3600_000)) {
            this.sessions.delete(sessionId);
            return undefined;
        }
        return structuredClone(s.state);
    }
    async save(sessionId, state) {
        this.sessions.delete(sessionId); // re-insert so the Map stays ordered by last use
        this.sessions.set(sessionId, { state: structuredClone(state), seen: Date.now() });
        const max = this.opts.maxSessions ?? 500;
        while (this.sessions.size > max)
            this.sessions.delete(this.sessions.keys().next().value);
    }
}
/**
 * Optional: keep memory in an OmniRoute server (https://github.com/diegosouzapw/OmniRoute) instead,
 * so several smart-router processes share it. Each session is one entry.
 *
 * OMNIROUTE_URL      e.g. http://localhost:20128
 * OMNIROUTE_API_KEY  only needed when OmniRoute has auth enabled (needs the manage scope)
 */
export class OmniRouteStore {
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
    async load(sessionId) {
        const url = `${this.baseUrl}/api/memory?sessionId=${encodeURIComponent(sessionId)}&limit=1`;
        const res = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(2000) });
        if (!res.ok)
            return undefined;
        const { data = [] } = (await res.json());
        const entry = data.find(m => m.key === `smart-router:${sessionId}`) ?? data[0];
        return entry ? JSON.parse(entry.content) : undefined;
    }
    async save(sessionId, state) {
        await fetch(`${this.baseUrl}/api/memory`, {
            method: "POST",
            headers: this.headers(),
            signal: AbortSignal.timeout(2000),
            // OmniRoute upserts on "key", so each session stays one entry.
            body: JSON.stringify({ key: `smart-router:${sessionId}`, type: "episodic", sessionId, content: JSON.stringify(state) })
        });
    }
}
/**
 * Memory is on by default and lives inside smart-router.
 * SMART_ROUTER_MEMORY=off         turns it off
 * SMART_ROUTER_MEMORY_TOKENS=2000 most tokens of earlier context handed to a request
 * OMNIROUTE_URL                   optional: keep it in an OmniRoute server
 */
export function memoryFromEnv(env = process.env) {
    if (/^(off|false|0|no)$/i.test(env.SMART_ROUTER_MEMORY ?? ""))
        return undefined;
    const store = env.OMNIROUTE_URL ? new OmniRouteStore(normalizeUrl(env.OMNIROUTE_URL), env.OMNIROUTE_API_KEY) : new LocalStore();
    const tokens = Number(env.SMART_ROUTER_MEMORY_TOKENS);
    return new ConversationMemory(store, { tokens: tokens > 0 ? tokens : undefined });
}
/** Earlier context as user/assistant messages. Works for both OpenAI and Anthropic formats. */
export function historyMessages({ summary, turns }) {
    const out = [];
    if (summary) {
        out.push({ role: "user", content: `Summary of our conversation so far:\n${summary}` });
        out.push({ role: "assistant", content: "Understood. I have that context." });
    }
    for (const t of turns) {
        if (!t.prompt || !t.reply)
            continue;
        out.push({ role: "user", content: t.prompt }, { role: "assistant", content: t.reply });
    }
    return out;
}
/** Earlier context as plain text, for single-prompt APIs like Ollama's /api/generate. */
export function historyText({ summary, turns }) {
    const parts = summary ? [`Summary of earlier conversation:\n${summary}`] : [];
    for (const t of turns)
        if (t.prompt && t.reply)
            parts.push(`User: ${t.prompt}\nAssistant: ${t.reply}`);
    return parts.join("\n\n");
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
