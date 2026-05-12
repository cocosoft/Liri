/**
 * 企业版审计模块导出
 */

export { EnterpriseAuditService, AuditEventType } from './EnterpriseAuditService.js';
export { ApprovalWorkflow } from './ApprovalWorkflow.js';

export type {
  AuditEvent,
  AuditQuery,
  AuditQueryResult,
  AuditStats,
  AuditSeverity,
  AuditEventType as AuditEventTypeEnum,
  EnterpriseAuditConfig,
} from './EnterpriseAuditService.js';

export type {
  ApprovalRequest,
  ApprovalRecord,
  ApprovalPolicy,
  ApprovalStatus,
  ApprovalLevel,
  ApprovalAction,
  ApproverConfig,
  ApprovalWorkflowConfig,
  EscalationEvent,
} from './ApprovalWorkflow.js';
