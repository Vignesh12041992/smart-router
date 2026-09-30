export const DEFAULT_OLLAMA_URL = process.env.OLLAMA_HOST
    ? normalizeUrl(process.env.OLLAMA_HOST)
    : "http://localhost:11434";
/** Used when Ollama is not reachable, so routing still returns a sensible model name. */
export const DEFAULT_MODELS = ["phi:latest", "qwen2.5-coder:7b", "deepseek-r1:8b", "llama3:latest"];
export const ROUTING_TIERS = [
    {
        key: "micro",
        description: "Basic greetings, chit-chat, conversational entries, and short responses.",
        fallbackKeywords: ["phi", "gemma", "llama3.2:1b"],
        hintWords: ["hi", "hello", "hey", "thanks", "thank", "how are you", "joke", "good morning", "bye"]
    },
    {
        key: "coder",
        description: "Source code setups, structural scripts, bug fixes, and development patterns.",
        fallbackKeywords: ["coder", "code", "qwen"],
        hintWords: [
            "code", "function", "script", "bug", "debug", "error", "python", "javascript", "typescript", "java",
            "rust", "golang", "sql", "api", "class", "compile", "regex", "refactor", "unit test", "npm", "git"
        ]
    },
    {
        key: "reasoner",
        description: "Deep multi-step analysis framework engineering, logic systems, and math puzzles.",
        fallbackKeywords: ["deepseek-r1", "reasoning", "r1"],
        hintWords: [
            "prove", "proof", "math", "equation", "calculate", "logic", "puzzle", "reason", "step by step",
            "theorem", "probability", "derive", "optimize", "algorithm", "complexity"
        ]
    },
    {
        key: "general",
        description: "Document write-ups, mixed general analysis summaries, and system essays.",
        fallbackKeywords: ["llama3", "mistral", "latest"],
        hintWords: ["write", "essay", "summarize", "summary", "explain", "describe", "email", "article", "story", "report"]
    }
];
export function normalizeUrl(url) {
    const withScheme = /^https?:\/\//i.test(url) ? url : `http://${url}`;
    return withScheme.replace(/\/+$/, "");
}
