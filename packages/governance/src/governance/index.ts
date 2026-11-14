// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * 治理闭环统一入口
 * 导出所有治理相关的类型和类
 */
export * from '@modules/governance/types/GovernanceTypes';
export { GovernanceManager } from '@modules/governance/managers/GovernanceManager';
export {
  GovernanceConfigManager,
  governanceConfigManager,
  type ConfigVersion,
  type ConfigEvent,
} from '@modules/governance/managers/GovernanceConfigManager';
export {
  GovernanceAuditService,
  governanceAuditService,
  type AuditEvent,
  type AuditQueryOptions,
  type AuditStatistics,
} from '@modules/governance/managers/GovernanceAuditService';
export {
  GovernanceStrategyManager,
  governanceStrategyManager,
  type GovernanceStrategy,
  type GovernanceRule,
  type GovernanceStrategyType,
  type StrategyEvent,
} from '@modules/governance/managers/GovernanceStrategyManager';

// 导出增强功能
export * from '@modules/governance/EnhancedGovernanceManager.js';

// 导出主动式规则建议引擎
export {
  RuleSuggestionEngine,
  ruleSuggestionEngine,
} from '@modules/governance/RuleSuggestionEngine.js';
export type {
  RuleSuggestion,
  DetectedPattern,
  SuggestionPatternType,
  SuggestionStatus,
  SuggestionQueryOptions,
  RuleSuggestionEngineConfig,
} from '@modules/governance/RuleSuggestionEngine.js';
export * from '@modules/governance/IntelligentGovernanceAnalyzer.js';
