/**
 * 治理系统入口
 * 提供治理闭环的核心功能
 */

export * from './types/GovernanceTypes.js';
export { GovernanceManager } from './managers/GovernanceManager.js';
export {
  GovernanceConfigManager,
  governanceConfigManager,
} from './managers/GovernanceConfigManager.js';
export {
  GovernanceAuditService,
  governanceAuditService,
} from './managers/GovernanceAuditService.js';
export {
  GovernanceStrategyManager,
  governanceStrategyManager,
} from './managers/GovernanceStrategyManager.js';
