import { Readable } from "stream";
import type { Express, Request, Response } from "express";
import {
  DEFAULT_ANTHROPIC_URL, DEFAULT_OPENROUTER_URL, claudeModels, openRouterModels, normalizeUrl, type TierKey
} from "./config/registry.js";
import type { IntelligentRouter } from "./services/router.js";
import { OmniRouteMemory, contextBlock, replyText } from "./services/memory.js";

/**
 * Where Claude Code requests (/v1/messages) go:
 *   "anthropic"  - straight to Anthropic with the tool's OWN login. No extra key. (default)
 *   "openrouter" - to OpenRouter with an OpenRouter key.
 */
export type ClaudeProvider = "anthropic" | "openrouter";

export interface ProxyOptions {
  claudeProvider?: ClaudeProvider;
  /** Anthropic API base, e.g. https://api.anthropic.com/v1 */
  anthropicUrl?: string;
  /** Claude model for each tier (anthropic provider). */
  claudeModels?: Record<TierKey, string>;
  /** OpenRouter API base, e.g. https://openrouter.ai/api/v1 */
  upstreamUrl?: string;
  /** Used when the client does not send its own OpenRouter key. */
  apiKey?: string;
  /** Model for each tier. */
  models?: Record<TierKey, string>;
  /** Conversation memory (OmniRoute). Defaults to the one configured by OMNIROUTE_URL, if any. */
  memory?: OmniRouteMemory;
}

/**
 * Adds the endpoints coding tools talk to:
 *   POST /v1/chat/completions  OpenAI format  (Copilot, Devin, Cursor, Continue, Aider, ...)
 *   POST /v1/messages          Anthropic format (Claude Code) - uses Claude Code's own login by default
 *   GET  /v1/models
 * Each request is routed to a tier, then forwarded to OpenRouter. Streaming is passed straight through.
 */
export function mountProxy(app: Express, router: IntelligentRouter, opts: ProxyOptions = {}) {
  const upstream = normalizeUrl(opts.upstreamUrl ?? process.env.OPENROUTER_BASE_URL ?? DEFAULT_OPENROUTER_URL);
  const models = opts.models ?? openRouterModels();
  const serverKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
  const claudeProvider: ClaudeProvider =
    opts.claudeProvider ?? (process.env.SMART_ROUTER_CLAUDE_PROVIDER === "openrouter" ? "openrouter" : "anthropic");
  const anthropicUrl = normalizeUrl(opts.anthropicUrl ?? process.env.SMART_ROUTER_ANTHROPIC_URL ?? DEFAULT_ANTHROPIC_URL);
  const claudeTiers = opts.claudeModels ?? claudeModels();
  const memory = opts.memory ?? OmniRouteMemory.fromEnv();

  /** One conversation = one session. Clients can pin it with the X-Smart-Router-Session header. */
  const sessionOf = (req: Request, body: any): string =>
    String(req.headers["x-smart-router-session"] ?? body.metadata?.user_id ?? body.user ?? "default");

  /**
   * Gives a request that carries no history of its own the earlier turns of its session.
   * Tools that resend the whole conversation (Claude Code, Copilot) already carry the context.
   */
  const withMemory = async (body: any, format: "openai" | "anthropic", session: string) => {
    if (!memory || !Array.isArray(body.messages) || body.messages.length > 1) return body;
    const history = await memory.recall(session);
    if (!history) return body;
    const note = contextBlock(history);
    if (format === "openai") return { ...body, messages: [{ role: "system", content: note }, ...body.messages] };
    const system = typeof body.system === "string" ? [{ type: "text", text: body.system }] : body.system ?? [];
    return { ...body, system: [{ type: "text", text: note }, ...system] };
  };

  const saveTurn = (session: string, prompt: string, tier: string, model: string) =>
    memory && prompt && tier !== "manual"
      ? (reply: string) => { if (reply) void memory.remember(session, { prompt, reply, tier, model }); }
      : undefined;

  app.get("/v1/models", (_req, res) => {
    const ids = ["smart-router/auto", ...new Set(Object.values(models))];
    res.json({ object: "list", data: ids.map(id => ({ id, object: "model", owned_by: "smart-router" })) });
  });

  /**
   * Claude Code with its own login: only the "model" field changes. The tool's own auth headers
   * (API key or Claude subscription token) go straight to Anthropic, so no extra key is needed.
   */
  const passthroughClaude = (path: string) => async (req: Request, res: Response) => {
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
      }
    }
    res.setHeader("X-Smart-Router-Tier", tier);
    res.setHeader("X-Smart-Router-Model", model);
    if (path === "messages") console.error(`[smart-router] claude ${tier} ${requested} -> ${model}${body.stream ? " (stream)" : ""}`);

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    for (const h of ["authorization", "x-api-key", "anthropic-version", "anthropic-beta"]) {
      const v = req.headers[h];
      if (v) headers[h] = Array.isArray(v) ? v.join(",") : v;
    }
    const session = sessionOf(req, body);
    const outBody = path === "messages" && tier !== "manual" ? await withMemory(body, "anthropic", session) : body;
    await forward(res, "anthropic", `${anthropicUrl}/${path}${queryString(req)}`, headers, { ...outBody, model },
      path === "messages" ? saveTurn(session, prompt, tier, model) : undefined);
  };

  const forward = async (res: Response, format: "openai" | "anthropic", url: string, headers: Record<string, string>, body: unknown, onReply?: (reply: string) => void) => {
    let upstreamRes: globalThis.Response;
    try {
      upstreamRes = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    } catch (err: any) {
      return sendError(res, format, 502, `Could not reach ${new URL(url).host}: ${err.message}`);
    }
    res.status(upstreamRes.status);
    res.setHeader("Content-Type", upstreamRes.headers.get("content-type") ?? "application/json");
    if (!upstreamRes.body) return res.end();
    const stream = Readable.fromWeb(upstreamRes.body as any);
    stream.pipe(res);
    if (onReply && upstreamRes.ok) {
      const decoder = new TextDecoder();
      let raw = "";
      stream.on("data", chunk => { if (raw.length < 400_000) raw += decoder.decode(chunk, { stream: true }); });
      stream.on("end", () => onReply(replyText(raw)));
    }
  };

  const handle = (format: "openai" | "anthropic") => async (req: Request, res: Response) => {
    const body = req.body ?? {};
    const key = clientKey(req) ?? serverKey;
    if (!key) {
      return sendError(res, format, 401, "No OpenRouter API key. Set OPENROUTER_API_KEY, or send it as your tool's API key.");
    }
    if (!Array.isArray(body.messages)) return sendError(res, format, 400, "Request body needs a \"messages\" array.");

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

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": "https://github.com/Vignesh12041992/smart-router",
      "X-Title": "smart-router"
    };
    if (format === "anthropic") headers["anthropic-version"] = String(req.headers["anthropic-version"] ?? "2023-06-01");

    const session = sessionOf(req, body);
    const outBody = tier !== "manual" ? await withMemory(body, format, session) : body;
    await forward(res, format, `${upstream}/${format === "openai" ? "chat/completions" : "messages"}`, headers,
      { ...outBody, model }, saveTurn(session, prompt, tier, model));
  };

  app.post("/v1/chat/completions", wrap(handle("openai"), "openai"));
  if (claudeProvider === "anthropic") {
    app.post("/v1/messages", wrap(passthroughClaude("messages"), "anthropic"));
    app.post("/v1/messages/count_tokens", wrap(passthroughClaude("messages/count_tokens"), "anthropic"));
  } else {
    app.post("/v1/messages", wrap(handle("anthropic"), "anthropic"));
  }
}

/** Text of the last user message. Handles plain strings and content-part arrays (OpenAI and Anthropic). */
export function lastUserText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      const text = m.content
        .filter((p: any) => p?.type === "text" && typeof p.text === "string")
        .map((p: any) => p.text)
        .join("\n");
      if (text.trim()) return text; // Claude Code sends tool results as user turns; keep looking past those.
    }
  }
  return "";
}

function queryString(req: Request): string {
  const i = req.originalUrl.indexOf("?");
  return i === -1 ? "" : req.originalUrl.slice(i);
}

function clientKey(req: Request): string | undefined {
  const auth = req.headers.authorization;
  const bearer = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : undefined;
  const key = bearer || (req.headers["x-api-key"] as string | undefined);
  // Only forward keys that look like OpenRouter keys; tools often send placeholder values.
  return key?.startsWith("sk-or-") ? key : undefined;
}

function sendError(res: Response, format: "openai" | "anthropic", status: number, message: string) {
  if (format === "anthropic") return res.status(status).json({ type: "error", error: { type: "api_error", message } });
  return res.status(status).json({ error: { message, type: "smart_router_error" } });
}

function wrap(fn: (req: Request, res: Response) => Promise<unknown>, format: "openai" | "anthropic") {
  return (req: Request, res: Response) => {
    fn(req, res).catch(err => {
      if (res.headersSent) return res.end();
      sendError(res, format, 500, err?.message ?? String(err));
    });
  };
}
