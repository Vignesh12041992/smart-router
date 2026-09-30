/** Small in-memory cache so the same prompt always gets the same routing decision. */
export class MemoryCacheService<T> {
  private store = new Map<string, T>();

  constructor(private maxEntries = 500) {}

  get(prompt: string): T | undefined {
    return this.store.get(key(prompt));
  }

  set(prompt: string, value: T): void {
    const k = key(prompt);
    this.store.delete(k);
    this.store.set(k, value);
    if (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
  }

  get size(): number {
    return this.store.size;
  }
}

function key(prompt: string): string {
  return prompt.trim().replace(/\s+/g, " ").toLowerCase();
}
