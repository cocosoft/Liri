// canvas-editor/utils/autoSave.ts — IndexedDB 自动保存（3版本保留 + 命令计数触发）

export interface SnapMeta {
  version: number;
  width: number;
  height: number;
  bgColor: string;
  zoom: number;
  savedAt: number;
}

const DB_NAME = "canvas-editor";
const STORE_NAME = "snapshots";
const MAX_VERSIONS = 3;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getKeys(db: IDBDatabase, prefix: string): Promise<string[]> {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const keys: string[] = [];
    const cursorReq = tx.objectStore(STORE_NAME).openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        if (String(cursor.key).startsWith(prefix))
          keys.push(String(cursor.key));
        cursor.continue();
      } else resolve(keys);
    };
  });
}

/** 保存快照到 IndexedDB（自动清理超出 MAX_VERSIONS 的旧版本） */
export async function saveSnapshot(
  canvasId: string,
  dataUrl: string,
  meta: SnapMeta,
): Promise<void> {
  try {
    const db = await openDB();
    const prefix = `${canvasId}:`;

    // 记录新版本号
    const keys = await getKeys(db, prefix);
    const existing = keys
      .map((k) => parseInt(k.slice(prefix.length), 10))
      .filter((n) => !isNaN(n));
    const nextVer = existing.length > 0 ? Math.max(...existing) + 1 : 1;

    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    // 保存新快照
    store.put(dataUrl, `${prefix}${nextVer}`);
    store.put(
      JSON.stringify({ ...meta, version: nextVer }),
      `${prefix}meta_${nextVer}`,
    );

    // 清理超出 MAX_VERSIONS 的旧版本
    const sorted = [...existing, nextVer].sort((a, b) => b - a);
    for (const v of sorted.slice(MAX_VERSIONS)) {
      store.delete(`${prefix}${v}`);
      store.delete(`${prefix}meta_${v}`);
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // 静默跳过，不阻塞用户操作
  }
}

/** 检测是否有快照 */
export async function hasSnapshot(canvasId: string): Promise<boolean> {
  try {
    const db = await openDB();
    const keys = await getKeys(db, `${canvasId}:`);
    return keys.some((k) => /^\d+$/.test(k.slice(canvasId.length + 1)));
  } catch {
    return false;
  }
}

/** 获取最新快照 dataUrl */
export async function getLatestSnapshot(
  canvasId: string,
): Promise<{ dataUrl: string; meta: SnapMeta } | null> {
  try {
    const db = await openDB();
    const keys = await getKeys(db, `${canvasId}:`);
    const metaKeys = keys.filter((k) => k.startsWith(`${canvasId}:meta_`));
    if (metaKeys.length === 0) return null;

    const versions = metaKeys
      .map((k) => {
        const v = k.slice(canvasId.length + 6); // 去掉 `${canvasId}:meta_`
        return parseInt(v, 10);
      })
      .filter((n) => !isNaN(n))
      .sort((a, b) => b - a);

    if (versions.length === 0) return null;

    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const latestVer = versions[0];

    const metaRaw = await new Promise<string>((resolve, reject) => {
      const req = store.get(`${canvasId}:meta_${latestVer}`);
      req.onsuccess = () => resolve(req.result as string);
      req.onerror = () => reject(req.error);
    });

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const req = store.get(`${canvasId}:${latestVer}`);
      req.onsuccess = () => resolve(req.result as string);
      req.onerror = () => reject(req.error);
    });

    return { dataUrl, meta: JSON.parse(metaRaw) as SnapMeta };
  } catch {
    return null;
  }
}

/** 清除指定画布的所有自动保存快照（取消编辑时调用） */
export async function clearAutoSave(canvasId: string): Promise<void> {
  try {
    const db = await openDB();
    const keys = await getKeys(db, `${canvasId}:`);
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const key of keys) {
      store.delete(key);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // 静默跳过
  }
}
