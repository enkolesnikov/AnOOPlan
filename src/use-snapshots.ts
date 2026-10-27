import { useState } from 'react';
import type { MutableRefObject } from 'react';
import type { Project } from './model';
import { cloneValue as clone } from './compat';
import { idbStoreDelete, idbStoreGet, idbStoreKeys, idbStorePut } from './idb';

export interface SnapshotEntry {
  key: string;
  createdAt: string;
  reason: string;
  project: Project;
}

const SNAPSHOT_LIMIT = 20;

interface Options {
  projectRef: MutableRefObject<Project>;
  load: (project: unknown, exists: boolean) => void;
  onGarbageCollect: () => void;
  setError: (message: string) => void;
  setMessage: (message: string) => void;
}

/** История версий проекта в IndexedDB: снимки, восстановление и очистка. */
export function useSnapshots({ projectRef, load, onGarbageCollect, setError, setMessage }: Options) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotEntry[] | null>(null);

  async function takeSnapshot(reason: string): Promise<void> {
    const snapshot = clone(projectRef.current);
    const prefix = `${snapshot.id}:`;
    const key = `${prefix}${Date.now()}`;
    await idbStorePut('snapshots', key, { key, createdAt: new Date().toISOString(), reason, project: snapshot });
    const keys = (await idbStoreKeys('snapshots'))
      .filter(item => item.startsWith(prefix))
      .sort((a, b) => Number(b.slice(prefix.length)) - Number(a.slice(prefix.length)));
    for (const stale of keys.slice(SNAPSHOT_LIMIT)) await idbStoreDelete('snapshots', stale);
  }

  async function openHistory(): Promise<void> {
    setHistoryOpen(true);
    setSnapshots(null);
    try {
      const projectId = projectRef.current.id;
      const prefix = `${projectId}:`;
      const keys = (await idbStoreKeys('snapshots'))
        .filter(item => item.startsWith(prefix))
        .sort((a, b) => Number(b.slice(prefix.length)) - Number(a.slice(prefix.length)));
      const list: SnapshotEntry[] = [];
      for (const key of keys) {
        const entry = await idbStoreGet<SnapshotEntry>('snapshots', key);
        if (entry) list.push(entry);
      }
      setSnapshots(list);
    } catch {
      setSnapshots([]);
      setError('История версий недоступна: хранилище браузера закрыто.');
    }
  }

  async function restoreSnapshot(key: string): Promise<void> {
    const entry = snapshots?.find(item => item.key === key);
    if (!entry) return;
    if (!window.confirm(`Восстановить проект от ${new Date(entry.createdAt).toLocaleString('ru-RU')}? Текущее состояние сохранится как снимок.`)) return;
    try { await takeSnapshot('перед восстановлением'); } catch (error) {
      setError(`Не удалось сохранить текущее состояние: ${error instanceof Error ? error.message : String(error)}. Восстановление отменено.`);
      return;
    }
    load(clone(entry.project), true);
    setHistoryOpen(false);
    setSnapshots(null);
    setMessage('Проект восстановлен из снимка.');
  }

  async function deleteSnapshot(key: string): Promise<void> {
    try { await idbStoreDelete('snapshots', key); } catch { /* уже удалён */ }
    setSnapshots(current => (current || []).filter(item => item.key !== key));
    onGarbageCollect();
  }

  return { historyOpen, setHistoryOpen, snapshots, setSnapshots, takeSnapshot, openHistory, restoreSnapshot, deleteSnapshot };
}
