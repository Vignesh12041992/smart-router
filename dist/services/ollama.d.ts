export declare function listOllamaModels(baseUrl: string, timeoutMs?: number): Promise<string[]>;
/** Streams tokens from Ollama's /api/generate. Calls onToken for each piece of text. */
export declare function streamOllama(baseUrl: string, model: string, prompt: string, onToken: (token: string) => void): Promise<void>;
