import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { streamOllama } from "./services/ollama.js";
import { mountProxy } from "./proxy.js";
import { memoryFromEnv, historyText } from "./services/memory.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export function createApp(router, proxy = {}) {
    const app = express();
    app.use(express.json({ limit: "50mb" })); // coding tools send large contexts
    const memory = proxy.memory === undefined ? memoryFromEnv() : proxy.memory || undefined;
    mountProxy(app, router, { ...proxy, memory: memory ?? false });
    app.use(express.static(path.join(__dirname, "../public")));
    app.get("/api/status", (_req, res) => {
        res.json({ engine: router.activeEngine, ollamaOnline: router.ollamaOnline, models: router.ollamaModels, memory: memory?.kind ?? "off" });
    });
    app.post("/api/route", async (req, res) => {
        try {
            res.json(await router.processRequest(String(req.body?.prompt ?? "")));
        }
        catch (err) {
            res.status(400).json({ error: err.message });
        }
    });
    app.get("/api/stream", async (req, res) => {
        const { model, prompt, tier } = req.query;
        const session = String(req.query.session ?? "dashboard");
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        try {
            // Ollama's /api/generate takes one prompt, so earlier turns (possibly answered by another model) go in as text.
            const history = memory ? historyText(await memory.recall(session)) : "";
            const full = history
                ? `Earlier turns of this conversation (some answered by other models):\n\n${history}\n\nUser: ${prompt}\nAssistant:`
                : String(prompt);
            let reply = "";
            await streamOllama(router.ollamaUrl, String(model), full, token => {
                reply += token;
                res.write(`data: ${JSON.stringify({ token })}\n\n`);
            });
            if (memory && reply)
                void memory.remember(session, { prompt: String(prompt), reply, tier: String(tier ?? "ollama"), model: String(model) });
        }
        catch (err) {
            res.write(`data: ${JSON.stringify({ error: `Could not reach Ollama at ${router.ollamaUrl}: ${err.message}` })}\n\n`);
        }
        res.write("data: [DONE]\n\n");
        res.end();
    });
    return app;
}
export function startServer(router, port, host = "127.0.0.1", proxy = {}) {
    return new Promise((resolve, reject) => {
        const server = createApp(router, proxy).listen(port, host, () => resolve(server));
        server.on("error", reject);
    });
}
