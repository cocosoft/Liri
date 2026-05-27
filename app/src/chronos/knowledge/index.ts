/**
 * 知识库维护模块
 * 定时编译 raw/ 文件、更新摘要缓存、执行健康检查
 */
export {
  runKnowledgeMaintenance,
  registerKnowledgeMaintenanceTask,
  unregisterKnowledgeMaintenanceTask,
  DEFAULT_MAINTENANCE_CRON,
  KNOWLEDGE_MAINTENANCE_TASK_ID,
} from './knowledgeMaintenance';
export type { KnowledgeMaintenanceResult } from './knowledgeMaintenance';
