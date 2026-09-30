export async function listOllamaModels(baseUrl: string, timeoutMs = 3000): Promise<string[]> {
  const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
  const data = (await res.json()) as { models?: Array<{ name: string }> };
  return (data.models ?? []).map(m => m.name);
}

/** Streams tokens from Ollama's /api/generate. Calls onToken for each piece of text. */
export async function streamOllama(
  baseUrl: string,
  model: string,
  prompt: string,
  onToken: (token: string) => void
): Promise<void> {
  const res = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: true })
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama returned ${res.status}${text ? `: ${text.trim()}` : ""}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line, onToken);
  }
  handleLine(buffer, onToken);
}

function handleLine(line: string, onToken: (token: string) => void) {
  if (!line.trim()) return;
  let parsed: { response?: string; error?: string };
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }
  if (parsed.error) throw new Error(`Ollama: ${parsed.error}`);
  if (parsed.response) onToken(parsed.response);
}
