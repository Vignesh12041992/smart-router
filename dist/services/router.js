import { Laya } from "@receptron/laya";
import { ROUTING_TIERS } from "../config/registry.js";
export class SmartRouter {
    layaInstance;
    async init() {
        // Local ONNX decision model boots up instantly on your local processor
        this.layaInstance = await Laya.load();
    }
    async routeTask(prompt) {
        if (!this.layaInstance)
            throw new Error("Router not initialized.");
        const criteria = {};
        ROUTING_TIERS.forEach(tier => {
            criteria[tier.key] = tier.description;
        });
        const result = await this.layaInstance.systemOne({ prompt }, {
            classification: {
                type: "choice",
                instructions: "Which technical model tier handles this prompt context best?",
                criteria
            },
            complexity: {
                type: "score",
                instructions: "Rate the structural and architectural logic complexity.",
                criteria: ["trivial conversation", "moderate editing", "complex programming logic", "extreme systemic deduction"]
            }
        });
        const matchedTierKey = result.answers.classification.choice;
        const score = result.answers.complexity.score;
        const confidence = result.answers.classification.probabilities[matchedTierKey];
        const tier = ROUTING_TIERS.find(t => t.key === matchedTierKey) || ROUTING_TIERS[3];
        return {
            modelName: tier.openRouterModel,
            complexityScore: score.toFixed(2),
            routingConfidence: (confidence * 100).toFixed(1) + "%"
        };
    }
}
//LOCAL WORKING CODE
// import { Laya } from "@receptron/laya";
// import { ROUTING_TIERS } from "../config/registry.js";
// export class SmartRouter {
//   private layaInstance: any;
//   private localOllamaModels: string[] = [];
//   async init() {
//     try {
//       const response = await fetch("http://localhost:11434/api/tags");
//       if (!response.ok) throw new Error("Ollama unreachable");
//       const data = await response.json() as { models: Array<{ name: string }> };
//       this.localOllamaModels = data.models.map(m => m.name);
//       console.log("📦 Detected local Ollama models:", this.localOllamaModels);
//     } catch (e) {
//       console.error("🚨 Failed to connect to local Ollama. UI will fall back to simulation.");
//     }
//     this.layaInstance = await Laya.load();
//   }
//   async routeTask(prompt: string) {
//     if (!this.layaInstance) throw new Error("Router not initialized.");
//     // Map the static tier keys to Laya instructions
//     const criteria: Record<string, string> = {};
//     ROUTING_TIERS.forEach(tier => {
//       criteria[tier.key] = tier.description;
//     });
//     const result = await this.layaInstance.systemOne(
//       { prompt },
//       {
//         classification: {
//           type: "choice",
//           instructions: "Which specialized technical tier handles this prompt context best?",
//           criteria
//         },
//         complexity: {
//           type: "score",
//           instructions: "Rate the structural and architectural logic complexity.",
//           criteria: ["trivial conversation", "moderate editing", "complex programming logic", "extreme systemic deduction"]
//         }
//       }
//     );
//     const matchedTierKey = result.answers.classification.choice as string;
//     const score = result.answers.complexity.score as number;
//     const confidence = result.answers.classification.probabilities[matchedTierKey] as number;
//     // Find the best available match from Ollama inventory for the selected tier
//     const resolvedModelName = this.resolveOllamaModel(matchedTierKey);
//     return {
//       tier: matchedTierKey,
//       modelName: resolvedModelName,
//       complexityScore: score.toFixed(2),
//       routingConfidence: (confidence * 100).toFixed(1) + "%"
//     };
//   }
//   private resolveOllamaModel(tierKey: string): string {
//     if (this.localOllamaModels.length === 0) return "No local models available";
//     const tier = ROUTING_TIERS.find(t => t.key === tierKey);
//     if (!tier) return this.localOllamaModels[0];
//     // Attempt matching keywords against local models
//     for (const kw of tier.fallbackKeywords) {
//       const match = this.localOllamaModels.find(m => m.toLowerCase().includes(kw.toLowerCase()));
//       if (match) return match;
//     }
//     // Fallbacks if target tier matches aren't pulled locally
//     if (tierKey === "coder") {
//       const backupCoder = this.localOllamaModels.find(m => m.includes("code") || m.includes("qwen"));
//       if (backupCoder) return backupCoder;
//     }
//     return this.localOllamaModels[0]; // Absorb using primary default model line
//   }
// }
// BELOW IS THE CODE FOR EVEROS AND FLOCKI
// import { Laya } from "@receptron/laya";
// import { PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
// import { dbClient, ROUTING_TIERS } from "../config/registry.js";
// import { MemoryCacheService } from "./cache.js";
// export class IntelligentRouter {
//   private laya: any;
//   private cache = new MemoryCacheService();
//   private ollamaModels: string[] = [];
//   async init() {
//     // Sync table state in Floci local database context
//     try {
//       this.ollamaModels = ["phi:latest", "qwen2.5-coder:7b", "deepseek-r1:8b", "llama3:latest"];
//       console.log("📡 Connected to Floci Infrastructure Stack.");
//     } catch {}
//     this.laya = await Laya.load();
//   }
//   async processRequest(prompt: string) {
//     // 1. Check EverOS for a cached decision to guarantee deterministic outputs
//     const cachedDecision = await this.cache.checkCache(prompt);
//     if (cachedDecision) {
//       return { ...cachedDecision, cached: true };
//     }
//     // 2. Execute Laya System-1 parsing across technical tiers if it's a new prompt
//     const criteria: Record<string, string> = {};
//     ROUTING_TIERS.forEach(t => { criteria[t.key] = t.description; });
//     const result = await this.laya.systemOne(
//       { prompt },
//       {
//         classification: { type: "choice", instructions: "Map core programming or context domain.", criteria },
//         complexity: { type: "score", instructions: "Rate the technical density required.", criteria: ["conversational", "scripts", "architecture"] }
//       }
//     );
//     const tier = result.answers.classification.choice;
//     const score = result.answers.complexity.score;
//     const conf = result.answers.classification.probabilities[tier];
//     const modelName = this.matchOllama(tier);
//     const decision = { modelName, complexityScore: score.toFixed(2), confidence: (conf * 100).toFixed(1) + "%" };
//     // 3. Persist transaction into Floci DynamoDB ledger logs for operational audit trails
//     try {
//       await dbClient.send(new PutCommand({
//         TableName: "RouterAuditHistory",
//         Item: { PromptId: Date.now().toString(), PromptText: prompt, TargetModel: modelName, Complexity: score }
//       }));
//     } catch {}
//     return { ...decision, cached: false };
//   }
//   private matchOllama(tierKey: string): string {
//     const tier = ROUTING_TIERS.find(t => t.key === tierKey);
//     if (!tier) return "llama3:latest";
//     for (const kw of tier.fallbackKeywords) {
//       const found = this.ollamaModels.find(m => m.includes(kw));
//       if (found) return found;
//     }
//     return "llama3:latest";
//   }
//   async saveResponseToMemory(prompt: string, response: string, decision: any) {
//     await this.cache.saveMemory(prompt, response, decision);
//   }
// }
