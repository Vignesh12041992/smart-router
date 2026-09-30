// export interface ModelConfig {
//   id: string; // The exact Ollama model name (e.g., 'llama3:8b')
//   name: string;
//   description: string;
// }
export const ROUTING_TIERS = [
    {
        key: "micro",
        description: "Ideal for basic questions, chit-chat, conversational greetings, and short, trivial text answers.",
        fallbackKeywords: ["phi", "gemma", "llama3.2:1b", "llama3.2:3b", "qwen2.5:0.5b", "qwen2.5:1.5b"]
    },
    {
        key: "coder",
        description: "Specialized in structural programming, writing source code, debugging scripts, and systems engineering blueprints.",
        fallbackKeywords: ["coder", "code", "starcoder", "deepseek-coder"]
    },
    {
        key: "reasoner",
        description: "Heavyweight reasoning model engineered explicitly for multi-step deep analysis, logical systems, and complex mathematics.",
        fallbackKeywords: ["deepseek-r1", "reasoning", "r1", "qwq"]
    },
    {
        key: "general",
        description: "Standard model for mixed utility tasks, generating comprehensive essays, document synthesis, and general data formats.",
        fallbackKeywords: ["llama3", "mistral", "qwen2.5:7b", "latest"]
    }
];
