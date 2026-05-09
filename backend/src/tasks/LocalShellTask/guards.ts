//
/**
 * LocalShellTask 类型守卫和辅助类型
 * 从 LocalBashTask 中提取的纯类型 + 类型守卫，使非 React 模块
 * （如 killShellTasks）可以在不拉入 React/Ink 模块图的情况下使用
 *
 * 基于 CC源码 cc_code/backend/tasks/LocalShellTask/guards.ts 实现
 */

import { TaskType, type TaskState } from '../types';

/**
 * Bash任务种类：'bash' 普通shell任务 / 'monitor' 监控任务
 */
export type BashTaskKind = 'bash' | 'monitor';

/**
 * LocalShellTask 扩展状态
 * 在 TaskState 基础上添加bash特有的字段
 */
export interface LocalShellTaskState extends TaskState {
  type: TaskType.LOCAL_BASH;
  command: string;
  result?: {
    code: number;
    interrupted: boolean;
  };
  completionStatusSentInAttachment: boolean;
  shellCommand: unknown;
  unregisterCleanup?: () => void;
  cleanupTimeoutId?: ReturnType<typeof setTimeout>;
  lastReportedTotalLines: number;
  isBackgrounded: boolean;
  agentId?: string;
  kind?: BashTaskKind;
}

/**
 * 类型守卫：判断 TaskState 是否为 LocalShellTaskState
 */
export function isLocalShellTask(task: unknown): task is LocalShellTaskState {
  return (
    typeof task === 'object' &&
    task !== null &&
    'type' in task &&
    task.type === 'local_bash'
  );
}
