'use client';

/**
 * GPS Breadcrumb Queue using IndexedDB
 * Queues GPS points when offline, auto-syncs when connection returns.
 */

const DB_NAME = 'dgaj_gps_queue';
const STORE_NAME = 'breadcrumbs';
const DB_VERSION = 1;

export interface GPSBreadcrumb {
  id?: number;
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  recorded_at: string;
  work_date: string;
  synced?: boolean;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('synced', 'synced', { unique: false });
        store.createIndex('user_id', 'user_id', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function queueBreadcrumb(crumb: Omit<GPSBreadcrumb, 'id' | 'synced'>): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).add({ ...crumb, synced: false });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('[GPSQueue] Failed to queue breadcrumb:', err);
  }
}

export async function getPendingBreadcrumbs(): Promise<GPSBreadcrumb[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const index = tx.objectStore(STORE_NAME).index('synced');
      const req = index.getAll(IDBKeyRange.only(false));
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function markBreadcrumbsSynced(ids: number[]): Promise<void> {
  if (!ids.length) return;
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      let pending = ids.length;
      ids.forEach((id) => {
        const getReq = store.get(id);
        getReq.onsuccess = () => {
          const record = getReq.result;
          if (record) {
            record.synced = true;
            store.put(record);
          }
          pending--;
          if (pending === 0) resolve();
        };
        getReq.onerror = () => {
          pending--;
          if (pending === 0) resolve();
        };
      });
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('[GPSQueue] Failed to mark synced:', err);
  }
}

export async function clearSyncedBreadcrumbs(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const index = tx.objectStore(STORE_NAME).index('synced');
      const req = index.openCursor(IDBKeyRange.only(true));
      req.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('[GPSQueue] Failed to clear synced:', err);
  }
}

/**
 * Syncs all pending breadcrumbs to Supabase route_tracking table.
 * Call this when network comes back online.
 */
export async function syncPendingBreadcrumbs(
  supabaseInsert: (rows: Omit<GPSBreadcrumb, 'id' | 'synced'>[]) => Promise<{ error: any }>
): Promise<number> {
  let pending = await getPendingBreadcrumbs();
  if (!pending.length) return 0;

  const rows = pending.map(({ id: _id, synced: _s, ...rest }) => rest);
  const { error } = await supabaseInsert(rows);

  if (!error) {
    const ids = pending.map((c) => c.id!).filter(Boolean) as number[];
    await markBreadcrumbsSynced(ids);
    await clearSyncedBreadcrumbs();
    return rows.length;
  } else {
    console.error('[GPSQueue] Sync failed:', error);
    return 0;
  }
}
