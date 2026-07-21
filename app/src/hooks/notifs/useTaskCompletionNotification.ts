import { useEffect, useRef } from 'react';

import { appStateStore } from '../../system/state/AppStateStore';
import type { AppState } from '../../system/state/AppState';
import { TaskStatus } from '../../tasks/types';

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

        const wasRunning = prevTask.status === TaskStatus.RUNNING;
        const isDone =
          currTask.status === TaskStatus.COMPLETED ||
          currTask.status === TaskStatus.FAILED ||
          currTask.status === TaskStatus.LOST;
        if (!wasRunning || !isDone) continue;

        const type =
          currTask.status === TaskStatus.COMPLETED ? 'success' : 'warning';
        const label =
          currTask.status === TaskStatus.COMPLETED
            ? '完成'
            : currTask.status === TaskStatus.FAILED
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
