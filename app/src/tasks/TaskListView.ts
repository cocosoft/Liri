/**
 * TaskListView — Todo 任务列表 UI 组件骨架
 *
 * P3-13: 对标 cc_code TaskListV2.tsx + useTasksV2.ts。
 * 面向用户的任务列表前端组件。可延迟实现完整 UI，先提供数据接口。
 */
export interface TaskListViewItem {
  id: string;
  subject: string;
  status: 'pending' | 'in_progress' | 'completed';
  owner: string;
  priority: number;
  blockedBy: string[];
  blocks: string[];
  createdAt: number;
  updatedAt: number;
}

export interface TaskListViewConfig {
  /** 是否自动隐藏已完成任务（默认 5s） */
  autoHideCompletedMs: number;
  /** 最多显示的任务数 */
  maxVisible: number;
  /** 排序方式 */
  sortBy: 'status' | 'priority' | 'createdAt' | 'updatedAt';
}

const DEFAULT_CONFIG: TaskListViewConfig = {
  autoHideCompletedMs: 5000,
  maxVisible: 20,
  sortBy: 'status',
};

/**
 * P3-13: 任务列表排序与过滤
 */
export function sortAndFilterTasks(
  tasks: TaskListViewItem[],
  config: Partial<TaskListViewConfig> = {}
): TaskListViewItem[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const now = Date.now();

  // Filter: hide old completed tasks
  const visible = tasks.filter(
    (t) =>
      t.status !== 'completed' || now - t.updatedAt < cfg.autoHideCompletedMs
  );

  // Sort
  const sorted = [...visible].sort((a, b) => {
    switch (cfg.sortBy) {
      case 'priority':
        return a.priority - b.priority;
      case 'createdAt':
        return b.createdAt - a.createdAt;
      case 'updatedAt':
        return b.updatedAt - a.updatedAt;
      case 'status':
      default: {
        const statusOrder = { in_progress: 0, pending: 1, completed: 2 };
        return (statusOrder[a.status] ?? 0) - (statusOrder[b.status] ?? 0);
      }
    }
  });

  return sorted.slice(0, cfg.maxVisible);
}

/**
 * P3-13: 生成紧凑状态栏标签
 * 对标 cc_code getPillLabel
 */
export function getTaskPillLabel(tasks: TaskListViewItem[]): string {
  const counts: Record<string, number> = {};
  for (const t of tasks) {
    if (t.status === 'completed') continue;
    counts[t.status] = (counts[t.status] ?? 0) + 1;
  }
  const parts: string[] = [];
  if (counts.in_progress) parts.push(`${counts.in_progress} doing`);
  if (counts.pending) parts.push(`${counts.pending} pending`);
  return parts.length > 0 ? parts.join(', ') : 'idle';
}
