#!/usr/bin/env node
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "util";
import { normalizeUrl } from "./config/registry.js";
import { IntelligentRouter, isLayaDownloaded } from "./services/router.js";
import { streamOllama } from "./services/ollama.js";
import { startServer } from "./server.js";
import { importLaya, installLaya, LAYA_HOME } from "./services/laya.js";
import { memoryFromEnv } from "./services/memory.js";
import { claudeModels, openRouterModels } from "./config/registry.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(__dirname, "../package.json"), "utf8"));
const HELP = `smart-router ${pkg.version}
Route prompts to the right model. Works as a drop-in API for Claude Code,
GitHub Copilot, Devin and other coding tools (forwards to OpenRouter).

Usage:
  smart-router route "<prompt>"     Show which model fits the prompt
  smart-router run "<prompt>"       Route the prompt, then answer it with Ollama
  smart-router serve                Start the proxy (/v1/chat/completions, /v1/messages) and dashboard
  smart-router models               List the Ollama models it can use
  smart-router download             Install the optional Laya AI router (~2 GB, one time)
  smart-router doctor               Check Node.js, Ollama and the Laya model
  smart-router version              Show version

The prompt can also be piped in:  echo "fix my python bug" | smart-router route

Options:
  -e, --engine <auto|laya|keyword>  Routing engine (default: auto)
                                    auto    = Laya if already downloaded, else keyword
                                    laya    = Laya AI model (run "smart-router download" first)
                                    keyword = fast, offline, no download
      --ollama-url <url>            Ollama address (default: $OLLAMA_HOST or http://localhost:11434)
  -p, --port <number>               Port for "serve" (default: 3000)

Environment:
  SMART_ROUTER_CLAUDE_<TIER>_MODEL  Claude model per tier for Claude Code: MICRO, CODER, REASONER, GENERAL
  OPENROUTER_API_KEY                Key for OpenAI-style tools (forwarded to OpenRouter)
  SMART_ROUTER_<TIER>_MODEL         OpenRouter model per tier
  SMART_ROUTER_CLAUDE_PROVIDER      Set to "openrouter" to send Claude Code to OpenRouter instead
  SMART_ROUTER_MEMORY               Conversation memory across model switches (default: on). "off" turns it off
  SMART_ROUTER_MEMORY_TOKENS        Most tokens of earlier context per request (default: 2000); older turns are summarized
      --host <address>              Host for "serve" (default: 127.0.0.1)
      --json                        Print "route" output as JSON
  -q, --quiet                       Hide progress messages
  -v, --version                     Show version
  -h, --help                        Show this help
`;
export async function main(argv) {
    let parsed;
    try {
        parsed = parseArgs({
            args: argv,
            allowPositionals: true,
            options: {
                engine: { type: "string", short: "e" },
                "ollama-url": { type: "string" },
                port: { type: "string", short: "p" },
                host: { type: "string" },
                json: { type: "boolean" },
                quiet: { type: "boolean", short: "q" },
                version: { type: "boolean", short: "v" },
                help: { type: "boolean", short: "h" }
            }
        });
    }
    catch (err) {
        console.error(`Error: ${err.message}\n\n${HELP}`);
        return 2;
    }
    const { values, positionals } = parsed;
    if (values.version || positionals[0] === "version") {
        console.log(pkg.version);
        return 0;
    }
    const [command, ...rest] = positionals;
    if (values.help || !command || command === "help") {
        console.log(HELP);
        return values.help || command === "help" ? 0 : 1;
    }
    const engine = (values.engine ?? "auto");
    if (!["auto", "laya", "keyword"].includes(engine)) {
        console.error(`Error: --engine must be auto, laya or keyword (got "${engine}").`);
        return 2;
    }
    const log = values.quiet ? () => { } : (msg) => console.error(msg);
    const ollamaUrl = values["ollama-url"] ? normalizeUrl(values["ollama-url"]) : undefined;
    switch (command) {
        case "route":
        case "run": {
            const prompt = rest.length ? rest.join(" ") : await readStdin();
            if (!prompt.trim()) {
                console.error(`Error: no prompt given. Try: smart-router ${command} "hello"`);
                return 2;
            }
            const router = new IntelligentRouter({ engine, ollamaUrl, log });
            await router.init();
            const decision = await router.processRequest(prompt);
            await router.close();
            if (command === "route") {
                if (values.json)
                    console.log(JSON.stringify(decision, null, 2));
                else {
                    console.log(`Model:       ${decision.modelName}`);
                    console.log(`Tier:        ${decision.tier}`);
                    console.log(`Complexity:  ${decision.complexityScore} / 3`);
                    console.log(`Confidence:  ${decision.confidence}`);
                    console.log(`Engine:      ${decision.engine}`);
                }
                return 0;
            }
            log(`→ ${decision.modelName} (${decision.tier}, complexity ${decision.complexityScore}, ${decision.engine})\n`);
            try {
                await streamOllama(router.ollamaUrl, decision.modelName, prompt, t => process.stdout.write(t));
                process.stdout.write("\n");
            }
            catch (err) {
                console.error(`\nError: could not get an answer from Ollama at ${router.ollamaUrl}: ${err.message}`);
                console.error("Is Ollama running? Start it with: ollama serve");
                return 1;
            }
            return 0;
        }
        case "serve": {
            const port = Number(values.port ?? process.env.PORT ?? 3000);
            if (!Number.isInteger(port) || port < 0 || port > 65535) {
                console.error(`Error: invalid port "${values.port}".`);
                return 2;
            }
            const router = new IntelligentRouter({ engine, ollamaUrl, log });
            await router.init();
            const server = await startServer(router, port, values.host ?? "127.0.0.1");
            const addr = server.address();
            const actualPort = typeof addr === "object" && addr ? addr.port : port;
            const base = `http://${values.host ?? "localhost"}:${actualPort}`;
            console.log(`Smart Router running at ${base}  (engine: ${router.activeEngine})\n`);
            console.log("Point your coding tool at it:");
            const viaOpenRouter = process.env.SMART_ROUTER_CLAUDE_PROVIDER === "openrouter";
            const fmt = (t) => Object.entries(t).map(([k, v]) => `${k}=${v}`).join("  ");
            if (viaOpenRouter)
                console.log(`  Claude Code:     ANTHROPIC_BASE_URL=${base} ANTHROPIC_AUTH_TOKEN=$OPENROUTER_API_KEY claude`);
            else
                console.log(`  Claude Code:     ANTHROPIC_BASE_URL=${base} claude      (uses your normal Claude login, no extra key)`);
            console.log(`  OpenAI-style:    base URL ${base}/v1, model "smart-router/auto"  (needs an OpenRouter key)`);
            console.log(`  Dashboard:       ${base}\n`);
            if (!viaOpenRouter)
                console.log("Claude Code models:  " + fmt(claudeModels()));
            console.log("OpenRouter models:   " + fmt(openRouterModels()));
            return new Promise(() => { }); // keep running until Ctrl+C
        }
        case "models": {
            const router = new IntelligentRouter({ engine: "keyword", ollamaUrl });
            await router.init();
            if (!router.ollamaOnline) {
                console.error(`Ollama not reachable at ${router.ollamaUrl}. Is it running? (ollama serve)`);
                return 1;
            }
            if (router.ollamaModels.length === 0)
                console.log("Ollama is running but has no models. Try: ollama pull llama3");
            router.ollamaModels.forEach(m => console.log(m));
            return 0;
        }
        case "download": {
            try {
                await importLaya();
            }
            catch {
                await installLaya(msg => console.error(msg));
            }
            const router = new IntelligentRouter({ engine: "laya", log: msg => console.error(msg) });
            await router.init();
            await router.close();
            console.log("Laya model is downloaded and ready.");
            return 0;
        }
        case "doctor":
            return doctor(ollamaUrl);
        default:
            console.error(`Error: unknown command "${command}".\n\n${HELP}`);
            return 2;
    }
}
async function doctor(ollamaUrl) {
    const ok = (msg) => console.log(`[ok] ${msg}`);
    const warn = (msg) => console.log(`[!!] ${msg}`);
    let healthy = true;
    console.log(`smart-router ${pkg.version} on ${process.platform}/${process.arch}\n`);
    const nodeMajor = Number(process.versions.node.split(".")[0]);
    if (nodeMajor >= 20)
        ok(`Node.js ${process.versions.node}`);
    else {
        warn(`Node.js ${process.versions.node} is too old. Install Node.js 20 or newer.`);
        healthy = false;
    }
    const router = new IntelligentRouter({ engine: "keyword", ollamaUrl });
    await router.init();
    if (!router.ollamaOnline)
        warn(`Ollama not reachable at ${router.ollamaUrl}. Install it from https://ollama.com and run: ollama serve`);
    else if (router.ollamaModels.length === 0)
        warn(`Ollama is running at ${router.ollamaUrl} but has no models. Try: ollama pull llama3`);
    else
        ok(`Ollama at ${router.ollamaUrl} with ${router.ollamaModels.length} model(s)`);
    if (process.env.OPENROUTER_API_KEY)
        ok("OPENROUTER_API_KEY is set");
    else
        console.log("[--] OPENROUTER_API_KEY not set. Only needed for OpenAI-style tools; Claude Code uses its own login.");
    const memory = memoryFromEnv();
    if (memory)
        ok(`Conversation memory on (${memory.kind}), no setup needed`);
    else
        console.log("[--] Conversation memory off (SMART_ROUTER_MEMORY=off)");
    try {
        const laya = await importLaya();
        ok("Laya package installed");
        if (isLayaDownloaded(laya))
            ok(`Laya model downloaded (${laya.defaultCacheDir()})`);
        else
            console.log(`[--] Laya model not downloaded. Optional: smart-router download`);
    }
    catch {
        console.log(`[--] Laya not installed. Using the fast keyword engine. Optional: smart-router download (installs to ${LAYA_HOME})`);
    }
    console.log(healthy ? "\nReady to route." : "\nFix the items above, then run: smart-router doctor");
    return healthy ? 0 : 1;
}
async function readStdin() {
    if (process.stdin.isTTY)
        return "";
    const chunks = [];
    for await (const chunk of process.stdin)
        chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8");
}
main(process.argv.slice(2)).then(code => { process.exitCode = code; }, err => {
    console.error(`Error: ${err?.message ?? err}`);
    process.exitCode = 1;
});
