export interface ModelTier {
  key: "micro" | "coder" | "reasoner" | "general";
  description: string;
  openRouterModel: string;
}

// Updated with robust, currently active OpenRouter free model parameters
export const ROUTING_TIERS: ModelTier[] = [
  {
    key: "micro",
    description: "Ideal for basic questions, chit-chat, conversational greetings, and short, trivial text answers.",
    openRouterModel: "openrouter/free" // Fast, reliable micro layer
  },
  {
    key: "coder",
    description: "Specialized in structural programming, writing source code, debugging scripts, and software engineering.",
    //openRouterModel: "meta-llama/llama-3.3-70b-instruct:free" // High performance coding tier
    openRouterModel: "openrouter/free" // High performance coding tier
  },
  {
    key: "reasoner",
    description: "Heavyweight reasoning model engineered explicitly for multi-step deep analysis, logical systems, and complex mathematics.",
    //openRouterModel: "deepseek/deepseek-r1:free" // Premier open reasoning engine
    openRouterModel: "openrouter/free" // Premier open reasoning engine
  },
  {
    key: "general",
    description: "Standard model for mixed utility tasks, generating comprehensive essays, document synthesis, and general layouts.",
    openRouterModel: "openrouter/free" // Automatically fallback routes to a healthy free tier instance
  }
];



// BELOW IS THE LOCAL WORKING CODE

// export interface ModelTier {
//   key: "micro" | "coder" | "reasoner" | "general";
//   description: string;
//   fallbackKeywords: string[];
// }

// export const ROUTING_TIERS: ModelTier[] = [
//   {
//     key: "micro",
//     description: "Ideal for basic questions, chit-chat, conversational greetings, and short, trivial text answers.",
//     fallbackKeywords: ["phi", "gemma", "llama3.2:1b", "llama3.2:3b", "qwen2.5:0.5b", "qwen2.5:1.5b"]
//   },
//   {
//     key: "coder",
//     description: "Specialized in structural programming, writing source code, debugging scripts, and systems engineering blueprints.",
//     fallbackKeywords: ["coder", "code", "starcoder", "deepseek-coder"]
//   },
//   {
//     key: "reasoner",
//     description: "Heavyweight reasoning model engineered explicitly for multi-step deep analysis, logical systems, and complex mathematics.",
//     fallbackKeywords: ["deepseek-r1", "reasoning", "r1", "qwq"]
//   },
//   {
//     key: "general",
//     description: "Standard model for mixed utility tasks, generating comprehensive essays, document synthesis, and general data formats.",
//     fallbackKeywords: ["llama3", "mistral", "qwen2.5:7b", "latest"]
//   }
// ];




// BELOW CODE IS FOR EVEROS AND FLOCKI
// import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
// import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

// export const EVEROS_ENDPOINT = "http://localhost:8000/api/v2";

// // Configure AWS SDK v2/v3 clients targeting Floci's local wire protocol port
// const rawClient = new DynamoDBClient({
//   endpoint: "http://localhost:4566",
//   region: "us-east-1",
//   credentials: { accessKeyId: "test", secretAccessKey: "test" }
// });

// export const dbClient = DynamoDBDocumentClient.from(rawClient);

// export const ROUTING_TIERS = [
//   { key: "micro", description: "Basic greetings, chit-chat, conversational entries, and short responses.", fallbackKeywords: ["phi", "gemma", "llama3.2:1b"] },
//   { key: "coder", description: "Source code setups, structural scripts, bug fixes, and development patterns.", fallbackKeywords: ["coder", "code", "qwen"] },
//   { key: "reasoner", description: "Deep multi-step analysis framework engineering, logic systems, and math puzzles.", fallbackKeywords: ["deepseek-r1", "reasoning", "r1"] },
//   { key: "general", description: "Document write-ups, mixed general analysis summaries, and system essays.", fallbackKeywords: ["llama3", "mistral", "latest"] }
// ];
