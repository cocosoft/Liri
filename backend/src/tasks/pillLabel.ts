//
/**
 * pillLabel - 后台任务状态UI标记生成
 *
 * 为一组后台任务生成紧凑的 footer-pill 标签
 * 同时用于 footer pill 和 turn-duration transcript 行，保证术语一致
 *
 * 基于 CC源码 cc_code/backend/tasks/pillLabel.ts 实现
 */

import { DIAMOND_FILLED, DIAMOND_OPEN } from '../constants/figures';
import type { TaskState } from './types';
import type { LocalShellTaskState } from './LocalShellTask/guards';
import type { InProcessTeammateTaskState } from './InProcessTeammateTask';

/**
 * 计算数组中符合条件的元素数量
 */
function count<T>(arr: T[], predicate: (item: T) => boolean): number {
  return arr.filter(predicate).length;
}

/**
 * 获取后台任务总数和详细描述
 */
export function getPillLabel(tasks: TaskState[]): string {
  const n = tasks.length;

  if (n === 0) {
    return '';
  }

  const allSameType = tasks.every(t => t.type === tasks[0]!.type);

  if (!allSameType) {
    return `${n} background ${n === 1 ? 'task' : 'tasks'}`;
  }

  switch (tasks[0]!.type) {
    case 'local_bash': {
      const shellTasks = tasks as unknown as LocalShellTaskState[];
      const monitors = count(
        shellTasks,
        t => t.type === 'local_bash' && t.kind === 'monitor',
      );
      const shells = n - monitors;
      const parts: string[] = [];
      if (shells > 0) {
        parts.push(shells === 1 ? '1 shell' : `${shells} shells`);
      }
      if (monitors > 0) {
        parts.push(monitors === 1 ? '1 monitor' : `${monitors} monitors`);
      }
      return parts.join(', ');
    }

    case 'in_process_teammate': {
      const teammateTasks = tasks as unknown as InProcessTeammateTaskState[];
      const teamCount = new Set(
        teammateTasks.map(t => t.identity.teamName),
      ).size;
      return teamCount === 1 ? '1 team' : `${teamCount} teams`;
    }

    case 'local_agent':
      return n === 1 ? '1 local agent' : `${n} local agents`;

    case 'remote_agent':
      return n === 1
        ? `${DIAMOND_OPEN} 1 cloud session`
        : `${DIAMOND_OPEN} ${n} cloud sessions`;

    case 'local_workflow':
      return n === 1 ? '1 background workflow' : `${n} background workflows`;

    case 'monitor_mcp':
      return n === 1 ? '1 monitor' : `${n} monitors`;

    case 'dream':
      return 'dreaming';

    default:
      return `${n} background ${n === 1 ? 'task' : 'tasks'}`;
  }
}

/**
 * 判断 pill 是否需要显示" · ↓ to view" 提示
 * 仅当任务处于需要注意的状态时才显示 CTA
 */
export function pillNeedsCta(tasks: TaskState[]): boolean {
  if (tasks.length !== 1) {
    return false;
  }

  const t = tasks[0]!;
  return (
    t.type === 'remote_agent'
  );
}
