/** Small in-memory cache so the same prompt always gets the same routing decision. */
export declare class MemoryCacheService<T> {
    private maxEntries;
    private store;
    constructor(maxEntries?: number);
    get(prompt: string): T | undefined;
    set(prompt: string, value: T): void;
    get size(): number;
}
