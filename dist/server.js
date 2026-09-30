import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { streamOllama } from "./services/ollama.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export function createApp(router) {
    const app = express();
    app.use(express.json());
    app.use(express.static(path.join(__dirname, "../public")));
    app.get("/api/status", (_req, res) => {
        res.json({ engine: router.activeEngine, ollamaOnline: router.ollamaOnline, models: router.ollamaModels });
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
        const { model, prompt } = req.query;
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        try {
            await streamOllama(router.ollamaUrl, String(model), String(prompt), token => {
                res.write(`data: ${JSON.stringify({ token })}\n\n`);
            });
        }
        catch (err) {
            res.write(`data: ${JSON.stringify({ error: `Could not reach Ollama at ${router.ollamaUrl}: ${err.message}` })}\n\n`);
        }
        res.write("data: [DONE]\n\n");
        res.end();
    });
    return app;
}
export function startServer(router, port, host = "127.0.0.1") {
    return new Promise((resolve, reject) => {
        const server = createApp(router).listen(port, host, () => resolve(server));
        server.on("error", reject);
    });
}
