/** Where saves and profiles are kept. This default holds them in memory, for the life of the process. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
}

const values = new Map<string, string>();

const memoryStore: KeyValueStore = {
  getItem: async (key) => values.get(key) ?? null,
  setItem: async (key, value) => {
    values.set(key, value);
  },
  removeItem: async (key) => {
    values.delete(key);
  },
  clear: async () => {
    values.clear();
  },
  getAllKeys: async () => [...values.keys()],
};

export default memoryStore;
