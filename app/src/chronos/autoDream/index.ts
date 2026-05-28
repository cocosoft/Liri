/**
 * AutoDream模块导出
 */

export {
  getAutoDreamConfig,
  isAutoDreamEnabled,
  resetAutoDreamConfigCache,
} from './AutoDreamConfig';
export {
  readLastConsolidatedAt,
  tryAcquireConsolidationLock,
  rollbackConsolidationLock,
  listSessionsTouchedSince,
  recordConsolidation,
  setAutoMemPath,
  getAutoMemPath,
} from './ConsolidationLock';
export {
  buildConsolidationPrompt,
  getMaxEntrypointLines,
  getEntrypointName,
} from './ConsolidationPrompt';
export { DreamAgentExecutor } from './DreamAgentExecutor';
export type {
  DreamExecutionConfig,
  DreamExecutionResult,
} from './DreamAgentExecutor';
export {
  initAutoDream,
  executeAutoDream,
  getDreamTask,
  getAllDreamTasks,
  isDreamTask,
  registerDreamTask,
  completeDreamTask,
  failDreamTask,
  addDreamTurn,
  onDreamEvent,
  offDreamEvent,
} from './AutoDream';
export type {
  DreamTask,
  DreamEvent,
  DreamEventType,
  DreamEventCallback,
} from './AutoDream';
