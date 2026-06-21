/**
 * 工作空间模块
 *
 * 负责 .liri/ 目录管理、工作空间配置、工作项生命周期。
 */

export * from './types';
export {
  LiriConfigManager,
  createLiriConfigManager,
  detectLiriDir,
} from './LiriConfigManager';
export { WorkItemStore, createWorkItemStore } from './WorkItemStore';
export { ChangeSetStore, createChangeSetStore } from './ChangeSetStore';
export { ProjectStore, createProjectStore } from './ProjectStore';
