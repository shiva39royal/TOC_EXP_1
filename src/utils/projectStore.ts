import type { StationProject } from '../types/signalling';

const DATABASE_NAME = 'signaltoc-offline';
const STORE_NAME = 'projects';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local project storage.'));
  });
}

export async function loadLocalProjects(): Promise<StationProject[]> {
  if (typeof indexedDB === 'undefined') return [];
  const database = await openDatabase();
  try {
    return await new Promise<StationProject[]>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result as StationProject[]).reverse());
      request.onerror = () => reject(request.error ?? new Error('Could not read local projects.'));
    });
  } finally {
    database.close();
  }
}

export async function saveLocalProjects(projects: StationProject[]): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.clear();
      for (const project of projects) store.put(project);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not save projects locally.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Local project save was interrupted.'));
    });
  } finally {
    database.close();
  }
}

export async function clearLocalProjects(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not clear local projects.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Local project clear was interrupted.'));
    });
  } finally {
    database.close();
  }
}

export async function clearAllStoredData(): Promise<void> {
  try {
    await clearLocalProjects();
  } catch {
    // ignore
  }
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.clear();
    } catch {
      // ignore
    }
  }
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.clear();
    } catch {
      // ignore
    }
  }
}
