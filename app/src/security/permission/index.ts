/**
 * Permission Module
 * 权限系统增强模块，统一导出
 */

export {
  PermissionContextBuilder,
  type PermissionContext,
  type UserIdentity,
  type ActionIntent,
  type ResourceIdentifier,
  type EnvironmentalContext,
  type PermissionDecision,
  type PermissionConstraint,
  type DecisionRecord,
} from './PermissionContext.js';

export {
  PermissionAuditLogger,
  globalAuditLogger,
  type AuditLogEntry,
  type AuditEventType,
  type AuditQuery,
} from './logging/PermissionAuditLogger.js';

export {
  InteractiveHandler,
  type InteractiveRequest,
  type InteractiveResponse,
  type InteractiveHandlerOptions,
} from './handler/InteractiveHandler.js';

export {
  CoordinatorHandler,
  type CoordinatedDecision,
  type WeightedDecision,
  type DecisionSource,
  type CoordinatorHandlerOptions,
} from './handler/CoordinatorHandler.js';

export {
  SwarmWorkerHandler,
  type SwarmWorkerIdentity,
  type SwarmPermissionContext,
} from './handler/SwarmWorkerHandler.js';
