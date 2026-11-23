// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `@openliri/tool-task` 公共出口 —— 任务与调度域。
 *
 * - `task_list` / `task_output` / `task_stop` / `kanban`：任务面；
 * - `cron` / `sleep` / `time`：调度与时间；
 * - `monitor` / `trace_recording` / `config` / `plan`：运行时支撑工具；
 * - `families/`：cron / sleep / task_list 三个同资源族工具。
 *
 * 注册动作（`builtinToolRegistry`）仍在 app：本包只提供工具实现。
 */

export { TaskStopTool } from './TaskTool/TaskStopTool';
export { TaskStopOutputSchema } from './TaskTool/schemas';
export {
  TaskCreateListTool,
  TaskUpdateStatusTool,
  TaskGetListTool,
} from './TaskOrchestratorTools/TaskOrchestratorTools';
export * from './TaskOrchestratorTools/TaskOrchestratorTools';
export { TaskOutputTool } from './TaskOutputTool/TaskOutputTool';
export { TaskOutputOutputSchema } from './TaskOutputTool/schemas';
export { CronCreateTool } from './ChronosTool/CronCreateTool';
export { CronDeleteTool } from './ChronosTool/CronDeleteTool';
export { CronListTool } from './ChronosTool/CronListTool';
export { CronStopTool } from './ChronosTool/CronStopTool';
export * from './KanbanTool/KanbanTool';
export { SleepTool } from './SleepTool/SleepTool';
export {
  createSleepForTool,
  createSleepUntilTool,
} from './SelfWakeTool/SelfWakeTool';
export { TimeTool } from './TimeTool/TimeTool';
export { MonitorTool } from './MonitorTool/MonitorTool';
export { TraceRecordingTool } from './TraceRecordingTool/TraceRecordingTool';
export { ConfigTool } from './ConfigTool/ConfigTool';
export * from './PlanTool/PlanTool';
export { PlanToolOutputSchema } from './PlanTool/schemas';
export { FamilyTool, mergeFamilyOutput } from './families/familyTool';
export type { FamilyMember } from './families/familyTool';
export { createCronFamilyTool } from './families/CronFamilyTool';
export { createSleepFamilyTool } from './families/SleepFamilyTool';
export { createTaskListFamilyTool } from './families/TaskListFamilyTool';
