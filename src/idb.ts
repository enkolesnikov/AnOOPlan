// Обёртки IndexedDB для PDF-подложек, фотографий и снимков проекта.
// Хранилище одно (`pdfs`): PDF лежат под UUID, фото — под `photo:<key>`.

const DB_NAME = 'cableplan';
const DB_VERSION = 2;
const BLOB_STORE = 'pdfs';
const SNAPSHOT_STORE = 'snapshots';

export function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(BLOB_STORE)) request.result.createObjectStore(BLOB_STORE);
      if (!request.result.objectStoreNames.contains(SNAPSHOT_STORE)) request.result.createObjectStore(SNAPSHOT_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB: ошибка запроса'));
  });
}

export async function idbPut(key: string, value: Blob): Promise<void> {
  const db = await idbOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE, 'readwrite');
    tx.objectStore(BLOB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB: ошибка транзакции'));
  });
}

export async function idbGet(key: string): Promise<Blob | undefined> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE, 'readonly');
    const request = tx.objectStore(BLOB_STORE).get(key);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB: ошибка запроса'));
  });
}

export async function idbDelete(key: string): Promise<void> {
  const db = await idbOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE, 'readwrite');
    tx.objectStore(BLOB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB: ошибка транзакции'));
  });
}

export async function idbStorePut(store: string, key: string, value: unknown): Promise<void> {
  const db = await idbOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB: ошибка транзакции'));
  });
}

export async function idbStoreGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB: ошибка запроса'));
  });
}

export async function idbStoreDelete(store: string, key: string): Promise<void> {
  const db = await idbOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB: ошибка транзакции'));
  });
}

export async function idbStoreKeys(store: string): Promise<string[]> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).getAllKeys();
    request.onsuccess = () => resolve((request.result as IDBValidKey[]).map(String));
    request.onerror = () => reject(request.error ?? new Error('IndexedDB: ошибка запроса'));
  });
}

export async function idbStoreGetAll<T>(store: string): Promise<T[]> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB: ошибка запроса'));
  });
}
