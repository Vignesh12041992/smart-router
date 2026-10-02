/** Small in-memory cache so the same prompt always gets the same routing decision. */
export class MemoryCacheService {
    maxEntries;
    store = new Map();
    constructor(maxEntries = 500) {
        this.maxEntries = maxEntries;
    }
    get(prompt) {
        return this.store.get(key(prompt));
    }
    set(prompt, value) {
        const k = key(prompt);
        this.store.delete(k);
        this.store.set(k, value);
        if (this.store.size > this.maxEntries) {
            const oldest = this.store.keys().next().value;
            if (oldest !== undefined)
                this.store.delete(oldest);
        }
    }
    get size() {
        return this.store.size;
    }
}
function key(prompt) {
    return prompt.trim().replace(/\s+/g, " ").toLowerCase();
}
