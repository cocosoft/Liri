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
// P1-19 ②（2026-10-08）：用户工作流模板 → workflow seam（装配层 + Provider + 幂等注册入口）
export {
  WorkflowTemplateProvider,
  registerWorkflowTemplateProvider,
  WORKFLOW_TEMPLATE_PROVIDER_ID,
} from './WorkflowTemplateProvider';
export {
  templateToDefinition,
  templateWorkflowName,
  TEMPLATE_WORKFLOW_PREFIX,
} from './workflowTemplateAssembly';
// P0-2(a)（2026-10-08）：模板执行入口（四态结果 + 依赖注入，供 service 层端口取用）
export { runWorkflowTemplate } from './workflowTemplateRunner';
export type {
  WorkflowTemplateRunOutcome,
  WorkflowTemplateRunnerDeps,
} from './workflowTemplateRunner';
