import { Readable } from "stream";
import { DEFAULT_ANTHROPIC_URL, DEFAULT_OPENROUTER_URL, claudeModels, openRouterModels, normalizeUrl } from "./config/registry.js";
import { memoryFromEnv, historyMessages, replyText } from "./services/memory.js";
/**
 * Adds the endpoints coding tools talk to:
 *   POST /v1/chat/completions  OpenAI format  (Copilot, Devin, Cursor, Continue, Aider, ...)
 *   POST /v1/messages          Anthropic format (Claude Code) - uses Claude Code's own login by default
 *   GET  /v1/models
 * Each request is routed to a tier, then forwarded to OpenRouter. Streaming is passed straight through.
 */
export function mountProxy(app, router, opts = {}) {
    const upstream = normalizeUrl(opts.upstreamUrl ?? process.env.OPENROUTER_BASE_URL ?? DEFAULT_OPENROUTER_URL);
    const models = opts.models ?? openRouterModels();
    const serverKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
    const claudeProvider = opts.claudeProvider ?? (process.env.SMART_ROUTER_CLAUDE_PROVIDER === "openrouter" ? "openrouter" : "anthropic");
    const anthropicUrl = normalizeUrl(opts.anthropicUrl ?? process.env.SMART_ROUTER_ANTHROPIC_URL ?? DEFAULT_ANTHROPIC_URL);
    const claudeTiers = opts.claudeModels ?? claudeModels();
    const memory = opts.memory === undefined ? memoryFromEnv() : opts.memory || undefined;
    /**
     * One conversation = one session. Clients can pin it with the X-Smart-Router-Session header.
     * Claude Code sends a per-conversation id in metadata.user_id. Otherwise each client address is one session.
     */
    const sessionOf = (req, body) => String(req.headers["x-smart-router-session"] ?? body.metadata?.user_id ?? body.user ?? `client:${req.ip}`);
    /**
     * Hands a request that carries no history of its own the earlier turns of its session, as real
     * user/assistant messages, so whichever model answers now continues the same conversation.
     * Tools that resend the whole conversation (Claude Code, Copilot) already carry it and are left alone.
     */
    const withMemory = async (res, body, session) => {
        res.setHeader("X-Smart-Router-Session", session);
        if (!memory || !Array.isArray(body.messages) || body.messages.some((m) => m?.role === "assistant"))
            return body;
        const recalled = await memory.recall(session);
        res.setHeader("X-Smart-Router-Memory", `${recalled.turns.length}${recalled.summary ? "+summary" : ""}`);
        const history = historyMessages(recalled);
        if (!history.length)
            return body;
        // Keep OpenAI system messages first; the Anthropic format keeps its system prompt outside "messages".
        const lead = body.messages.findIndex((m) => m?.role !== "system");
        const at = lead === -1 ? body.messages.length : lead;
        return { ...body, messages: [...body.messages.slice(0, at), ...history, ...body.messages.slice(at)] };
    };
    const saveTurn = (session, prompt, tier, model, summarize) => memory && prompt
        ? (reply) => { if (reply)
            void memory.remember(session, { prompt, reply, tier, model }, summarize); }
        : undefined;
    /** Summaries are written by the micro-tier model, with the same key the request used. */
    const openRouterSummarizer = (key) => async (system, user) => {
        const r = await fetch(`${upstream}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "X-Title": "smart-router" },
            signal: AbortSignal.timeout(30_000),
            body: JSON.stringify({ model: models.micro, max_tokens: 1024, messages: [{ role: "system", content: system }, { role: "user", content: user }] })
        });
        if (!r.ok)
            throw new Error(`summary failed: ${r.status}`);
        const j = await r.json();
        return String(j.choices?.[0]?.message?.content ?? "");
    };
    /** With Claude Code's own login, summaries use the micro-tier Claude model (Haiku by default). */
    const claudeSummarizer = (headers) => async (system, user) => {
        const r = await fetch(`${anthropicUrl}/messages`, {
            method: "POST",
            headers,
            signal: AbortSignal.timeout(30_000),
            body: JSON.stringify({ model: claudeTiers.micro, max_tokens: 1024, system, messages: [{ role: "user", content: user }] })
        });
        if (!r.ok)
            throw new Error(`summary failed: ${r.status}`);
        const j = await r.json();
        return (j.content ?? []).map((b) => b.text ?? "").join("");
    };
    app.get("/v1/models", (_req, res) => {
        const ids = ["smart-router/auto", ...new Set(Object.values(models))];
        res.json({ object: "list", data: ids.map(id => ({ id, object: "model", owned_by: "smart-router" })) });
    });
    /**
     * Claude Code with its own login: only the "model" field changes. The tool's own auth headers
     * (API key or Claude subscription token) go straight to Anthropic, so no extra key is needed.
     */
    const passthroughClaude = (path) => async (req, res) => {
        const body = req.body ?? {};
        const requested = String(body.model ?? "");
        let model = requested;
        let tier = "manual";
        let prompt = "";
        // Claude Code uses Haiku for small background jobs (titles, summaries). Leave those alone.
        if (!/haiku/i.test(requested) && Array.isArray(body.messages)) {
            prompt = lastUserText(body.messages);
            if (prompt) {
                const decision = await router.processRequest(prompt);
                model = claudeTiers[decision.tier];
                tier = decision.tier;
                // Haiku has a 200K context window. A long conversation stays on the general model instead.
                const size = /haiku/i.test(model) ? estimateTokens(body) : 0;
                if (size > HAIKU_MAX_INPUT_TOKENS) {
                    console.error(`[smart-router] ~${size} tokens is too long for Haiku; using the general model`);
                    model = claudeTiers.general;
                    tier = "general";
                }
            }
        }
        res.setHeader("X-Smart-Router-Tier", tier);
        res.setHeader("X-Smart-Router-Model", model);
        if (path === "messages")
            console.error(`[smart-router] claude ${tier} ${requested} -> ${model}${body.stream ? " (stream)" : ""}`);
        const headers = { "Content-Type": "application/json" };
        for (const h of ["authorization", "x-api-key", "anthropic-version", "anthropic-beta"]) {
            const v = req.headers[h];
            if (v)
                headers[h] = Array.isArray(v) ? v.join(",") : v;
        }
        const session = sessionOf(req, body);
        // Haiku background jobs (tier "manual" here) are not part of the conversation.
        const outBody = path === "messages" && tier !== "manual" ? await withMemory(res, body, session) : body;
        const fitted = tier === "manual" ? { ...outBody, model } : fitToClaudeModel({ ...outBody, model }, model);
        await forward(res, "anthropic", `${anthropicUrl}/${path}${queryString(req)}`, headers, fitted, path === "messages" ? saveTurn(session, prompt, tier, model, claudeSummarizer(headers)) : undefined);
    };
    const forward = async (res, format, url, headers, body, onReply) => {
        let upstreamRes;
        try {
            upstreamRes = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
        }
        catch (err) {
            return sendError(res, format, 502, `Could not reach ${new URL(url).host}: ${err.message}`);
        }
        res.status(upstreamRes.status);
        res.setHeader("Content-Type", upstreamRes.headers.get("content-type") ?? "application/json");
        if (!upstreamRes.body)
            return res.end();
        const stream = Readable.fromWeb(upstreamRes.body);
        stream.pipe(res);
        if (onReply && upstreamRes.ok) {
            const decoder = new TextDecoder();
            let raw = "";
            stream.on("data", chunk => { if (raw.length < 400_000)
                raw += decoder.decode(chunk, { stream: true }); });
            stream.on("end", () => onReply(replyText(raw)));
        }
    };
    const handle = (format) => async (req, res) => {
        const body = req.body ?? {};
        const key = clientKey(req) ?? serverKey;
        if (!key) {
            return sendError(res, format, 401, "No OpenRouter API key. Set OPENROUTER_API_KEY, or send it as your tool's API key.");
        }
        if (!Array.isArray(body.messages))
            return sendError(res, format, 400, "Request body needs a \"messages\" array.");
        // A full OpenRouter id like "anthropic/claude-sonnet-4" is used as is. Anything else ("auto",
        // "gpt-4o", "claude-sonnet-4-5" that Claude Code sends) is routed by smart-router.
        let model = String(body.model ?? "");
        let tier = "manual";
        const prompt = lastUserText(body.messages);
        if (!model.includes("/") || model === "smart-router/auto") {
            const decision = await router.processRequest(prompt || "hello");
            model = models[decision.tier];
            tier = decision.tier;
            res.setHeader("X-Smart-Router-Complexity", decision.complexityScore);
            res.setHeader("X-Smart-Router-Confidence", decision.confidence);
        }
        res.setHeader("X-Smart-Router-Tier", tier);
        res.setHeader("X-Smart-Router-Model", model);
        console.error(`[smart-router] ${format} ${tier} -> ${model}${body.stream ? " (stream)" : ""}`);
        const headers = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
            "HTTP-Referer": "https://github.com/Vignesh12041992/smart-router",
            "X-Title": "smart-router"
        };
        if (format === "anthropic")
            headers["anthropic-version"] = String(req.headers["anthropic-version"] ?? "2023-06-01");
        const session = sessionOf(req, body);
        const outBody = await withMemory(res, body, session);
        await forward(res, format, `${upstream}/${format === "openai" ? "chat/completions" : "messages"}`, headers, { ...outBody, model }, saveTurn(session, prompt, tier, model, openRouterSummarizer(key)));
    };
    app.post("/v1/chat/completions", wrap(handle("openai"), "openai"));
    if (claudeProvider === "anthropic") {
        app.post("/v1/messages", wrap(passthroughClaude("messages"), "anthropic"));
        app.post("/v1/messages/count_tokens", wrap(passthroughClaude("messages/count_tokens"), "anthropic"));
    }
    else {
        app.post("/v1/messages", wrap(handle("anthropic"), "anthropic"));
    }
}
/** Haiku's window is 200K, and input plus max_tokens must fit in it. */
const HAIKU_MAX_INPUT_TOKENS = 130_000;
const HAIKU_MAX_OUTPUT_TOKENS = 64_000;
/**
 * Claude Code shapes its request for the model it asked for (often Opus). When smart-router sends it to
 * Haiku instead, settings Haiku does not accept are adjusted, or the request fails with a 400:
 *   max_tokens above 64K, adaptive thinking, output_config.effort, and system messages inside "messages".
 * Sonnet and Opus accept what Claude Code sends, so other models are left as they are.
 */
export function fitToClaudeModel(body, model) {
    if (!/haiku/i.test(model))
        return body;
    const out = { ...body };
    if (typeof out.max_tokens === "number")
        out.max_tokens = Math.min(out.max_tokens, HAIKU_MAX_OUTPUT_TOKENS);
    // Haiku only takes {type: "enabled", budget_tokens}, with 1024 <= budget < max_tokens. Anything else: no thinking.
    if (out.thinking?.type === "enabled" && typeof out.max_tokens === "number") {
        const budget = Math.min(out.thinking.budget_tokens ?? 0, out.max_tokens - 1);
        out.thinking = budget >= 1024 ? { ...out.thinking, budget_tokens: budget } : undefined;
    }
    else if (out.thinking) {
        out.thinking = undefined;
    }
    if (!out.thinking)
        delete out.thinking;
    if (out.output_config && "effort" in out.output_config) {
        const { effort: _effort, ...rest } = out.output_config;
        if (Object.keys(rest).length)
            out.output_config = rest;
        else
            delete out.output_config;
    }
    // Mid-conversation system messages are newer than Haiku: keep their text as a user turn, drop effort-only ones.
    if (Array.isArray(out.messages) && out.messages.some((m) => m?.role === "system")) {
        out.messages = out.messages
            .filter((m) => m?.role !== "system" || (Array.isArray(m.content) ? m.content.length : m.content))
            .map((m) => (m?.role === "system" ? { role: "user", content: m.content } : m));
    }
    return out;
}
/**
 * Rough token count of a request: ~4 characters per token over the text. Images and PDFs count as
 * ~1600 tokens each (their base64 is far longer than what they cost), and thinking signatures are skipped.
 */
export function estimateTokens(body) {
    let chars = 0;
    const walk = (x) => {
        if (typeof x === "string")
            chars += x.length;
        else if (Array.isArray(x))
            x.forEach(walk);
        else if (x && typeof x === "object") {
            if ((x.type === "image" || x.type === "document") && x.source?.type === "base64") {
                chars += 1600 * 4;
                return;
            }
            for (const [k, v] of Object.entries(x))
                if (k !== "signature" && !(x.type === "redacted_thinking" && k === "data"))
                    walk(v);
        }
    };
    walk(body);
    return Math.ceil(chars / 4);
}
/** Claude Code adds context to the user's turn inside <system-reminder> tags. It is not part of the prompt. */
const stripReminders = (s) => s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
/** Text of the last user message. Handles plain strings and content-part arrays (OpenAI and Anthropic). */
export function lastUserText(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m?.role !== "user")
            continue;
        if (typeof m.content === "string") {
            const text = stripReminders(m.content);
            if (text)
                return text;
        }
        else if (Array.isArray(m.content)) {
            const text = m.content
                .filter((p) => p?.type === "text" && typeof p.text === "string")
                .map((p) => stripReminders(p.text))
                .filter(Boolean)
                .join("\n");
            if (text)
                return text; // Claude Code sends tool results as user turns; keep looking past those.
        }
    }
    return "";
}
function queryString(req) {
    const i = req.originalUrl.indexOf("?");
    return i === -1 ? "" : req.originalUrl.slice(i);
}
function clientKey(req) {
    const auth = req.headers.authorization;
    const bearer = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : undefined;
    const key = bearer || req.headers["x-api-key"];
    // Only forward keys that look like OpenRouter keys; tools often send placeholder values.
    return key?.startsWith("sk-or-") ? key : undefined;
}
function sendError(res, format, status, message) {
    if (format === "anthropic")
        return res.status(status).json({ type: "error", error: { type: "api_error", message } });
    return res.status(status).json({ error: { message, type: "smart_router_error" } });
}
function wrap(fn, format) {
    return (req, res) => {
        fn(req, res).catch(err => {
            if (res.headersSent)
                return res.end();
            sendError(res, format, 500, err?.message ?? String(err));
        });
    };
}
