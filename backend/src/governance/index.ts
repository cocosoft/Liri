/**
 * 治理闭环统一入口
 * 导出所有治理相关的类型和类
 */
export * from './types/GovernanceTypes';
export { GovernanceManager } from './managers/GovernanceManager';
export {
  GovernanceConfigManager,
  governanceConfigManager,
  type ConfigVersion,
  type ConfigEvent,
} from './managers/GovernanceConfigManager';
export {
  GovernanceAuditService,
  governanceAuditService,
  type AuditEvent,
  type AuditQueryOptions,
  type AuditStatistics,
} from './managers/GovernanceAuditService';
export {
  GovernanceStrategyManager,
  governanceStrategyManager,
  type GovernanceStrategy,
  type GovernanceRule,
  type GovernanceStrategyType,
  type StrategyEvent,
} from './managers/GovernanceStrategyManager';

// 导出增强功能
export * from './EnhancedGovernanceManager.js';
export * from './IntelligentGovernanceAnalyzer.js';
