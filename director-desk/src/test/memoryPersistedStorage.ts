// In-memory stand-in for directorPersistedStorage; jsdom has no IndexedDB.
export const memoryPersistedStore = new Map<string, unknown>();

const read = async <T>(key: string) => (memoryPersistedStore.has(key) ? (structuredClone(memoryPersistedStore.get(key)) as T) : null);
const write = async <T>(key: string, value: T) => {
  memoryPersistedStore.set(key, structuredClone(value));
};

export const readPersistedScene = read;
export const writePersistedScene = write;
export const readPersistedLocalModelAssets = read;
export const writePersistedLocalModelAssets = write;
