/**
 * 任务系统模块
 * 基于CC源码 cc_code/backend/tasks/ 实现
 */

// 导出类型
export type { TaskStatus, TaskType, TaskState } from './types';
export type {
  TaskContext,
  TaskEvent,
  AgentProgress,
  ToolActivity,
} from './types';

// 导出任务基类
export { BaseTask } from './BaseTask';

// 导出本地Bash任务
export {
  looksLikePrompt,
  LocalBashTaskOptions,
  LocalBashTask,
} from './LocalBashTask';

// 导出轻量笔记任务
export { NoteTask } from './NoteTask';

// 导出任务注册表（含便利方法）
export { TaskRegistry, taskRegistry } from './TaskRegistry';
export type { TaskInfo, TaskStats, DisplayStatus } from './TaskRegistry';
export { displayToTaskStatus, taskStatusToDisplay } from './TaskRegistry';

// 导出其他任务类型
export { LocalAgentTask } from './LocalAgentTask';
export { RemoteAgentTask } from './RemoteAgentTask';
export { DreamTask } from './DreamTask';
export { LocalWorkflowTask } from './LocalWorkflowTask';
export { MonitorMcpTask } from './MonitorMcpTask';
export { stopTask } from './stopTask';
export { InProcessTeammateTask } from './InProcessTeammateTask';

// 导出 BackgroundAgentTask 适配器
export {
  BackgroundAgentTask,
  backgroundTaskInfoToTaskState,
} from './BackgroundAgentTask';

// 导出 TaskOrchestrator
export { TaskOrchestrator, taskOrchestrator } from './TaskOrchestrator';
export type { Plan, PlanStep, PlanProgress } from './TaskOrchestrator';
