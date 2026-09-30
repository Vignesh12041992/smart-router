#!/usr/bin/env node
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "util";
import { normalizeUrl } from "./config/registry.js";
import { IntelligentRouter } from "./services/router.js";
import { streamOllama } from "./services/ollama.js";
import { startServer } from "./server.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(__dirname, "../package.json"), "utf8"));
const HELP = `smart-router ${pkg.version}
Pick the best local Ollama model for a prompt.

Usage:
  smart-router route "<prompt>"     Show which model fits the prompt
  smart-router run "<prompt>"       Route the prompt, then answer it with Ollama
  smart-router serve                Start the web dashboard
  smart-router models               List the Ollama models it can use
  smart-router download             Download the Laya model ahead of time

The prompt can also be piped in:  echo "fix my python bug" | smart-router route

Options:
  -e, --engine <auto|laya|keyword>  Routing engine (default: auto)
                                    laya    = Laya AI model (~1.7 GB download on first use)
                                    keyword = fast, offline, no download
                                    auto    = laya, falls back to keyword
      --ollama-url <url>            Ollama address (default: $OLLAMA_HOST or http://localhost:11434)
  -p, --port <number>               Port for "serve" (default: 3000)
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
    if (values.version) {
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
            console.log(`Dashboard ready at http://${values.host ?? "localhost"}:${actualPort}  (engine: ${router.activeEngine})`);
            if (!router.ollamaOnline)
                console.log(`Note: Ollama not found at ${router.ollamaUrl}. Routing works, answers will not.`);
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
            const router = new IntelligentRouter({ engine: "laya", log: msg => console.error(msg) });
            await router.init();
            await router.close();
            console.log("Laya model is downloaded and ready.");
            return 0;
        }
        default:
            console.error(`Error: unknown command "${command}".\n\n${HELP}`);
            return 2;
    }
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
