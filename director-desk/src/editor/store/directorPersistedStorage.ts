import localforage from "localforage";

const directorStore = localforage.createInstance({
  name: "infinite-canvas",
  storeName: "director_desk",
});

async function readValue<T>(key: string): Promise<T | null> {
  try {
    const value = await directorStore.getItem<T>(key);
    return value ?? null;
  } catch {
    return null;
  }
}

async function writeValue<T>(key: string, value: T): Promise<void> {
  try {
    await directorStore.setItem(key, value);
  } catch {
    // Keep the editor usable if the browser storage quota is exceeded.
  }
}

async function removeValue(key: string): Promise<void> {
  try {
    await directorStore.removeItem(key);
  } catch {
    // Ignore cleanup failures.
  }
}

export async function readPersistedScene<T>(key: string): Promise<T | null> {
  return readValue<T>(key);
}

export async function writePersistedScene<T>(key: string, value: T): Promise<void> {
  return writeValue(key, value);
}

export async function removePersistedScene(key: string): Promise<void> {
  return removeValue(key);
}

export async function readPersistedLocalModelAssets<T>(key: string): Promise<T | null> {
  return readValue<T>(key);
}

export async function writePersistedLocalModelAssets<T>(key: string, value: T): Promise<void> {
  return writeValue(key, value);
}
