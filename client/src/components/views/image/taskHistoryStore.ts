/**
 * taskHistoryStore — 任务执行历史 localStorage 持久化
 * P2-10: 最近 50 条记录，FIFO 淘汰
 */

export interface TaskHistory {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  success: boolean;
  error?: string;
  startedAt: number;
  completedAt: number;
}

const STORAGE_KEY = "liri-image-task-history";
const MAX_HISTORY = 50;

export function getHistory(): TaskHistory[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addHistory(
  entry: Omit<TaskHistory, "id" | "startedAt" | "completedAt"> & {
    startedAt?: number;
    completedAt?: number;
  },
): void {
  const list = getHistory();
  list.unshift({
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    startedAt: entry.startedAt ?? Date.now(),
    completedAt: entry.completedAt ?? Date.now(),
  });
  if (list.length > MAX_HISTORY) list.length = MAX_HISTORY;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // localStorage 满了则清空旧的重新存
    localStorage.removeItem(STORAGE_KEY);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 10)));
    } catch {
      /* silent */
    }
  }
}

export function clearHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}
