import { EVEROS_ENDPOINT } from "../config/registry.js";

export class MemoryCacheService {
  // Queries EverOS text history to see if an identical prompt was submitted
  async checkCache(prompt: string): Promise<any | null> {
    try {
      const res = await fetch(`${EVEROS_ENDPOINT}/memory/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: "dashboard_user",
          app_id: "router_app",
          project_id: "production",
          query: prompt,
          method: "keyword", // Use standard EverOS Keyword search for direct match accuracy
          top_k: 1
        })
      });

      if (!res.ok) return null;
      const data = await res.json();
      
      // If a match is found within historical memories, extract structural routing parameters
      if (data.results && data.results.length > 0) {
        const primaryMatch = data.results[0];
        if (primaryMatch.meta && primaryMatch.meta.decision) {
          return primaryMatch.meta.decision;
        }
      }
    } catch {
      // Fail safely if EverOS server instance is initializing
    }
    return null;
  }

  // Persists a newly completed execution route into EverOS Markdown storage files
  async saveMemory(prompt: string, responseText: string, decision: any) {
    try {
      const timestamp = Date.now();
      await fetch(`${EVEROS_ENDPOINT}/memory/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: "session_global",
          app_id: "router_app",
          project_id: "production",
          messages: [
            { sender_id: "user", role: "user", timestamp, content: prompt },
            { sender_id: "assistant", role: "assistant", timestamp: timestamp + 500, content: responseText }
          ],
          meta: { decision } // Binds the metadata decision configuration attributes
        })
      });

      // Flush session buffers immediately down onto disk storage layers
      await fetch(`${EVEROS_ENDPOINT}/memory/flush`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: "session_global", app_id: "router_app", project_id: "production" })
      });
    } catch (e) {
      console.error("EverOS storage sync delayed:", e);
    }
  }
}
