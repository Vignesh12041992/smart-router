import { DEFAULT_MODELS, DEFAULT_OLLAMA_URL, ROUTING_TIERS } from "../config/registry.js";
import { MemoryCacheService } from "./cache.js";
import { listOllamaModels } from "./ollama.js";
import { existsSync } from "fs";
import path from "path";
const COMPLEXITY_LEVELS = ["conversational", "scripts", "architecture", "deep multi-step reasoning"];
export class IntelligentRouter {
    opts;
    ollamaUrl;
    engine;
    laya;
    cache = new MemoryCacheService();
    log;
    ollamaModels = [];
    ollamaOnline = false;
    constructor(opts = {}) {
        this.opts = opts;
        this.engine = opts.engine ?? "auto";
        this.ollamaUrl = opts.ollamaUrl ?? DEFAULT_OLLAMA_URL;
        this.log = opts.log ?? (() => { });
        this.laya = opts.laya;
    }
    get activeEngine() {
        return this.laya ? "laya" : "keyword";
    }
    async init() {
        await this.refreshModels();
        if (this.laya || this.engine === "keyword")
            return;
        try {
            const layaPkg = await import("@receptron/laya");
            // "auto" never starts the big download by itself; only "laya" or `smart-router download` does.
            if (this.engine === "auto" && !isLayaDownloaded(layaPkg)) {
                this.log("Using the fast keyword engine. For AI routing, run once: smart-router download");
                return;
            }
            this.log(this.engine === "laya" ? "Loading Laya model (first run downloads ~1.7 GB)..." : "Loading Laya model...");
            const { Laya } = layaPkg;
            this.laya = await Laya.load({
                onProgress: progressPrinter(this.log)
            });
            this.log("Laya model ready.");
        }
        catch (err) {
            if (this.engine === "laya")
                throw new Error(`Could not load Laya model: ${err?.message ?? err}`);
            this.log(`Laya unavailable (${err?.message ?? err}). Using keyword engine instead.`);
        }
    }
    async refreshModels() {
        if (this.opts.models) {
            this.ollamaModels = this.opts.models;
            this.ollamaOnline = true;
            return;
        }
        try {
            this.ollamaModels = await listOllamaModels(this.ollamaUrl);
            this.ollamaOnline = true;
        }
        catch {
            this.ollamaOnline = false;
            this.ollamaModels = [];
        }
    }
    async processRequest(prompt) {
        if (!prompt || !prompt.trim())
            throw new Error("Prompt is empty.");
        const cached = this.cache.get(prompt);
        if (cached)
            return { ...cached, cached: true };
        const { tier, score, conf } = this.laya ? await this.classifyWithLaya(prompt) : classifyWithKeywords(prompt);
        const decision = {
            tier,
            modelName: this.matchModel(tier),
            complexityScore: score.toFixed(2),
            confidence: (conf * 100).toFixed(1) + "%",
            engine: this.activeEngine
        };
        this.cache.set(prompt, decision);
        return { ...decision, cached: false };
    }
    async close() {
        await this.laya?.close?.();
    }
    async classifyWithLaya(prompt) {
        const criteria = {};
        ROUTING_TIERS.forEach(t => { criteria[t.key] = t.description; });
        const result = await this.laya.systemOne({ prompt }, {
            classification: { type: "choice", instructions: "Map core programming or context domain.", criteria },
            complexity: { type: "score", instructions: "Rate the technical density required.", criteria: COMPLEXITY_LEVELS }
        });
        const tier = result.answers.classification.choice;
        return {
            tier,
            score: Number(result.answers.complexity.score),
            conf: Number(result.answers.classification.probabilities[tier])
        };
    }
    /** Picks the best installed Ollama model for a tier. */
    matchModel(tierKey) {
        const models = this.ollamaModels.length > 0 ? this.ollamaModels : DEFAULT_MODELS;
        const tier = ROUTING_TIERS.find(t => t.key === tierKey);
        for (const kw of tier?.fallbackKeywords ?? []) {
            const found = models.find(m => m.toLowerCase().includes(kw.toLowerCase()));
            if (found)
                return found;
        }
        return models[0];
    }
}
/** Offline router: counts hint words per tier and estimates complexity from length and keywords. */
export function classifyWithKeywords(prompt) {
    const text = ` ${prompt.toLowerCase().replace(/[^a-z0-9+#.\s]/g, " ").replace(/\s+/g, " ")} `;
    const counts = ROUTING_TIERS.map(t => ({
        key: t.key,
        hits: t.hintWords.filter(w => text.includes(` ${w} `) || text.includes(` ${w}s `)).length
    }));
    const words = prompt.trim().split(/\s+/).length;
    const total = counts.reduce((sum, c) => sum + c.hits, 0);
    let best = counts.reduce((a, b) => (b.hits > a.hits ? b : a));
    if (best.hits === 0)
        best = { key: words <= 6 ? "micro" : "general", hits: 0 };
    const conf = total === 0 ? 0.5 : 0.5 + 0.5 * (best.hits / total);
    const base = { micro: 0.3, general: 1.0, coder: 1.4, reasoner: 2.0 }[best.key];
    const lengthBoost = Math.min(1, words / 150);
    const score = Math.min(3, base + lengthBoost);
    return { tier: best.key, score, conf };
}
/** True when every file of the Laya bundle is already in the local cache. */
export function isLayaDownloaded(laya) {
    const dir = path.join(laya.defaultCacheDir(), laya.DEFAULT_REPO.replace("/", "--"), "main");
    return laya.BUNDLE_FILES.every(f => existsSync(path.join(dir, f)));
}
function progressPrinter(log) {
    let lastFile = "";
    let lastPct = -10;
    return ({ file, received, total }) => {
        if (file !== lastFile) {
            lastFile = file;
            lastPct = -10;
        }
        if (!total)
            return;
        const pct = Math.floor((received / total) * 100);
        if (pct >= lastPct + 10) {
            lastPct = pct;
            log(`  downloading ${file}: ${pct}%`);
        }
    };
}
