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
} from './AutoDream';
