import { Readable } from "stream";
import { DEFAULT_OPENROUTER_URL, openRouterModels, normalizeUrl } from "./config/registry.js";
/**
 * Adds the endpoints coding tools talk to:
 *   POST /v1/chat/completions  OpenAI format  (Copilot, Devin, Cursor, Continue, Aider, ...)
 *   POST /v1/messages          Anthropic format (Claude Code)
 *   GET  /v1/models
 * Each request is routed to a tier, then forwarded to OpenRouter. Streaming is passed straight through.
 */
export function mountProxy(app, router, opts = {}) {
    const upstream = normalizeUrl(opts.upstreamUrl ?? process.env.OPENROUTER_BASE_URL ?? DEFAULT_OPENROUTER_URL);
    const models = opts.models ?? openRouterModels();
    const serverKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
    app.get("/v1/models", (_req, res) => {
        const ids = ["smart-router/auto", ...new Set(Object.values(models))];
        res.json({ object: "list", data: ids.map(id => ({ id, object: "model", owned_by: "smart-router" })) });
    });
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
        if (!model.includes("/") || model === "smart-router/auto") {
            const prompt = lastUserText(body.messages) || "hello";
            const decision = await router.processRequest(prompt);
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
        let upstreamRes;
        try {
            upstreamRes = await fetch(`${upstream}/${format === "openai" ? "chat/completions" : "messages"}`, {
                method: "POST",
                headers,
                body: JSON.stringify({ ...body, model })
            });
        }
        catch (err) {
            return sendError(res, format, 502, `Could not reach OpenRouter at ${upstream}: ${err.message}`);
        }
        res.status(upstreamRes.status);
        res.setHeader("Content-Type", upstreamRes.headers.get("content-type") ?? "application/json");
        if (!upstreamRes.body)
            return res.end();
        Readable.fromWeb(upstreamRes.body).pipe(res);
    };
    app.post("/v1/chat/completions", wrap(handle("openai"), "openai"));
    app.post("/v1/messages", wrap(handle("anthropic"), "anthropic"));
}
/** Text of the last user message. Handles plain strings and content-part arrays (OpenAI and Anthropic). */
export function lastUserText(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m?.role !== "user")
            continue;
        if (typeof m.content === "string")
            return m.content;
        if (Array.isArray(m.content)) {
            const text = m.content
                .filter((p) => p?.type === "text" && typeof p.text === "string")
                .map((p) => p.text)
                .join("\n");
            if (text.trim())
                return text; // Claude Code sends tool results as user turns; keep looking past those.
        }
    }
    return "";
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
