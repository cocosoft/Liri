/**
 * 任务系统模块
 * 基于CC源码 cc_code/backend/tasks/ 实现
 */

// 导出类型
export type { TaskStatus, TaskType } from './types';

// 导出任务基类
export { BaseTask } from './BaseTask';

// 导出本地Bash任务
export {
  looksLikePrompt,
  LocalBashTaskOptions,
  LocalBashTask,
} from './LocalBashTask';

// 导出其他任务类型
export { LocalAgentTask } from './LocalAgentTask';
export { RemoteAgentTask } from './RemoteAgentTask';
export { DreamTask } from './DreamTask';
export { LocalWorkflowTask } from './LocalWorkflowTask';
export { MonitorMcpTask } from './MonitorMcpTask';
export { stopTask } from './stopTask';
export { InProcessTeammateTask } from './InProcessTeammateTask';

// 导出任务注册表
export { TaskRegistry, taskRegistry } from './TaskRegistry';
