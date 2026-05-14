import { useEffect, useRef } from 'react';

import { appStateStore } from '../../core/state/AppStateStore';
import type { AppState } from '../../core/state/AppState';

/**
 * 任务完成通知钩子
 * 监控任务状态变更，在任务完成时发出通知
 */
export function useTaskCompletionNotification(): void {
  const prevTasksRef = useRef<AppState['tasks']>({});

  useEffect(() => {
    const unsubscribe = appStateStore.subscribe((state) => {
      const prev = prevTasksRef.current;
      const curr = state.tasks;
      prevTasksRef.current = curr;

      for (const [taskId, currTask] of Object.entries(curr)) {
        const prevTask = prev[taskId];
        if (!prevTask) continue;

        const wasRunning = prevTask.status === 'running';
        const isDone =
          currTask.status === 'completed' ||
          currTask.status === 'failed' ||
          currTask.status === 'cancelled';
        if (!wasRunning || !isDone) continue;

        const type = currTask.status === 'completed' ? 'success' : 'warning';
        const label =
          currTask.status === 'completed'
            ? '完成'
            : currTask.status === 'failed'
              ? '失败'
              : '取消';

        appStateStore.addNotification({
          type,
          title: `任务${label}`,
          message: `任务 ${taskId.substring(0, 8)}... ${label}`,
          priority: 'low',
        });
      }
    });

    return unsubscribe;
  }, []);
}
