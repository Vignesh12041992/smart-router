// import { Laya } from "@receptron/laya";
// import { ModelConfig } from "../config/registry.js";
// export class SmartRouter {
//   private layaInstance: any;
//   private availableModels: ModelConfig[] = [];
//   async init() {
//     try {
//       const response = await fetch("http://localhost:11434/api/tags");
//       if (!response.ok) throw new Error("Failed to reach local Ollama instance.");
//       const data = await response.json() as { models: Array<{ name: string }> };
//       this.availableModels = data.models.map(m => {
//         let modelDescription = `A general-purpose local LLM named ${m.name} suitable for basic prompts and queries.`;
//         if (m.name.includes("coder") || m.name.includes("code")) {
//           modelDescription = `Specialized in writing code, scripts, software development, and structured engineering syntax.`;
//         } else if (m.name.includes("phi") || m.name.includes("gemma") || m.name.includes("llama3.2:1b") || m.name.includes("llama3.2:3b")) {
//           modelDescription = `A smaller, highly fast micro model for quick dialogue and basic text summaries.`;
//         } else if (m.name.includes("deepseek") || m.name.includes("reasoning") || m.name.includes("r1")) {
//           modelDescription = `Deeply complex multi-step reasoning, advanced math, logical thinking, and rigorous analysis.`;
//         }
//         const safeId = m.name.replace(/[:.]/g, "_");
//         return {
//           id: safeId,
//           name: m.name, 
//           description: modelDescription
//         };
//       });
//       if (this.availableModels.length === 0) {
//         console.warn("⚠️ Warning: Your Ollama list is empty! Run 'ollama pull <model>' first.");
//       }
//     } catch (error) {
//       console.error("🚨 Error loading local Ollama instance list.", error);
//     }
//     this.layaInstance = await Laya.load();
//   }
//   async routeTask(prompt: string) {
//     if (!this.layaInstance) {
//       throw new Error("Router service not initialized. Call init() first.");
//     }
//     if (this.availableModels.length === 0) {
//       return null;
//     }
//     const modelCriteria: Record<string, string> = {};
//     this.availableModels.forEach(m => {
//       modelCriteria[m.id] = m.description;
//     });
//     const result = await this.layaInstance.systemOne(
//       { prompt },
//       {
//         classification: {
//           type: "choice",
//           instructions: "Which local model profile is uniquely qualified to execute this prompt?",
//           criteria: modelCriteria
//         },
//         complexity: {
//           type: "score",
//           instructions: "Evaluate the complexity scale required by the task payload.",
//           criteria: ["trivial greeting", "moderate summary", "complex engineering application", "extreme logical systems"]
//         }
//       }
//     );
//     const chosenModelId = result.answers.classification.choice;
//     const score = result.answers.complexity.score;
//     const confidence = result.answers.classification.probabilities[chosenModelId];
//     const finalModel = this.availableModels.find(m => m.id === chosenModelId);
//     return {
//       modelName: finalModel ? finalModel.name : this.availableModels[0].name,
//       complexityScore: score.toFixed(2),
//       routingConfidence: (confidence * 100).toFixed(2) + "%"
//     };
//   }
//   async close() {
//     if (this.layaInstance) {
//       await this.layaInstance.close();
//     }
//   }
// }
import { Laya } from "@receptron/laya";
import { ROUTING_TIERS } from "../config/registry.js";
export class SmartRouter {
    layaInstance;
    localOllamaModels = [];
    async init() {
        try {
            const response = await fetch("http://localhost:11434/api/tags");
            if (!response.ok)
                throw new Error("Ollama unreachable");
            const data = await response.json();
            this.localOllamaModels = data.models.map(m => m.name);
            console.log("📦 Detected local Ollama models:", this.localOllamaModels);
        }
        catch (e) {
            console.error("🚨 Failed to connect to local Ollama. UI will fall back to simulation.");
        }
        this.layaInstance = await Laya.load();
    }
    async routeTask(prompt) {
        if (!this.layaInstance)
            throw new Error("Router not initialized.");
        // Map the static tier keys to Laya instructions
        const criteria = {};
        ROUTING_TIERS.forEach(tier => {
            criteria[tier.key] = tier.description;
        });
        const result = await this.layaInstance.systemOne({ prompt }, {
            classification: {
                type: "choice",
                instructions: "Which specialized technical tier handles this prompt context best?",
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
        // Find the best available match from Ollama inventory for the selected tier
        const resolvedModelName = this.resolveOllamaModel(matchedTierKey);
        return {
            tier: matchedTierKey,
            modelName: resolvedModelName,
            complexityScore: score.toFixed(2),
            routingConfidence: (confidence * 100).toFixed(1) + "%"
        };
    }
    resolveOllamaModel(tierKey) {
        if (this.localOllamaModels.length === 0)
            return "No local models available";
        const tier = ROUTING_TIERS.find(t => t.key === tierKey);
        if (!tier)
            return this.localOllamaModels[0];
        // Attempt matching keywords against local models
        for (const kw of tier.fallbackKeywords) {
            const match = this.localOllamaModels.find(m => m.toLowerCase().includes(kw.toLowerCase()));
            if (match)
                return match;
        }
        // Fallbacks if target tier matches aren't pulled locally
        if (tierKey === "coder") {
            const backupCoder = this.localOllamaModels.find(m => m.includes("code") || m.includes("qwen"));
            if (backupCoder)
                return backupCoder;
        }
        return this.localOllamaModels[0]; // Absorb using primary default model line
    }
}
