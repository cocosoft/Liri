/**
 * 治理管理器
 * 治理闭环的核心控制中心
 * 参考CC源码: cc_code/backend/services/agentGovernance.ts
 */

import { EventEmitter } from 'events';
import { governanceConfigManager } from './GovernanceConfigManager.js';
import { governanceAuditService } from './GovernanceAuditService.js';
import { governanceStrategyManager } from './GovernanceStrategyManager.js';

/**
 * 治理管理器类
 */
class GovernanceManager extends EventEmitter {
  constructor() {
    super();
    this.config = governanceConfigManager.getConfig();
    this.state = {
      activeExecutions: new Map(),
      completedExecutions: new Map(),
      pendingPermissions: new Map(),
    };
    this.initialize();
  }

  /**
   * 获取单例实例
   */
  static getInstance() {
    if (!GovernanceManager.instance) {
      GovernanceManager.instance = new GovernanceManager();
    }
    return GovernanceManager.instance;
  }

  /**
   * 初始化
   */
  initialize() {
    // 监听配置更新
    governanceConfigManager.on('configEvent', (event) => {
      this.config = governanceConfigManager.getConfig();
      this.emit('configUpdated', event);
    });

    // 监听策略更新
    governanceStrategyManager.on('strategyEvent', (event) => {
      this.emit('strategyUpdated', event);
    });

    // 监听审计事件
    governanceAuditService.on('auditEvent', (event) => {
      this.emit('auditEvent', event);
    });
  }

  /**
   * 检查工具是否可以执行
   */
  async canExecute(tool, context) {
    // 检查配置是否启用
    if (!this.config.enabled) {
      return {
        allowed: true,
        reason: 'Governance disabled',
        source: 'config',
      };
    }

    // 检查执行时间限制
    if (this.config.maxExecutionTimeMs && context.timeout && context.timeout > this.config.maxExecutionTimeMs) {
      return {
        allowed: false,
        reason: `Execution time exceeds maximum allowed time (${this.config.maxExecutionTimeMs}ms)`,
        source: 'config',
      };
    }

    // 检查并发执行限制
    if (!this.config.allowParallelExecution && this.state.activeExecutions.size > 0) {
      return {
        allowed: false,
        reason: 'Parallel execution not allowed',
        source: 'config',
      };
    }

    // 检查最大并发执行数
    if (this.config.maxConcurrentExecutions && this.state.activeExecutions.size >= this.config.maxConcurrentExecutions) {
      return {
        allowed: false,
        reason: `Maximum concurrent executions reached (${this.config.maxConcurrentExecutions})`,
        source: 'config',
      };
    }

    // 应用策略规则
    const strategyAction = governanceStrategyManager.applyStrategyRules(tool.name, context);
    if (strategyAction === 'deny') {
      return {
        allowed: false,
        reason: 'Denied by governance strategy',
        source: 'strategy',
      };
    }

    return {
      allowed: true,
      reason: 'Allowed by governance',
      source: 'governance',
    };
  }

  /**
   * 执行工具
   */
  async executeWithGovernance(tool, context, executeFn) {
    const startTime = Date.now();
    this.state.activeExecutions.set(context.toolUseId, 'validating');
    
    try {
      // 检查是否可以执行
      const canExecuteResult = await this.canExecute(tool, context);
      if (!canExecuteResult.allowed) {
        const result = {
          success: false,
          error: canExecuteResult.reason,
          durationMs: Date.now() - startTime,
          events: [],
          violations: [],
          governanceCheck: canExecuteResult,
        };

        // 记录审计事件
        governanceAuditService.logExecutionResult({
          ...result,
          toolName: tool.name,
          toolUseId: context.toolUseId,
          executionId: context.executionId,
        });

        this.state.activeExecutions.delete(context.toolUseId);
        this.state.completedExecutions.set(context.toolUseId, result);
        
        return result;
      }

      // 执行工具
      this.state.activeExecutions.set(context.toolUseId, 'executing');
      const executionResult = await executeFn(context.input);

      const result = {
        success: true,
        output: executionResult,
        durationMs: Date.now() - startTime,
        events: [],
        violations: [],
        governanceCheck: canExecuteResult,
      };

      // 记录审计事件
      governanceAuditService.logExecutionResult({
        ...result,
        toolName: tool.name,
        toolUseId: context.toolUseId,
        executionId: context.executionId,
      });

      this.state.activeExecutions.delete(context.toolUseId);
      this.state.completedExecutions.set(context.toolUseId, result);
      
      return result;
    } catch (error) {
      const result = {
        success: false,
        error: error.message || 'Unknown error',
        durationMs: Date.now() - startTime,
        events: [],
        violations: [],
        governanceCheck: {
          allowed: true,
          reason: 'Execution failed',
          source: 'execution',
        },
      };

      // 记录审计事件
      governanceAuditService.logExecutionResult({
        ...result,
        toolName: tool.name,
        toolUseId: context.toolUseId,
        executionId: context.executionId,
      });

      this.state.activeExecutions.delete(context.toolUseId);
      this.state.completedExecutions.set(context.toolUseId, result);
      
      return result;
    }
  }

  /**
   * 获取治理状态
   */
  getState() {
    return {
      config: this.config,
      activeExecutions: this.state.activeExecutions.size,
      completedExecutions: this.state.completedExecutions.size,
      pendingPermissions: this.state.pendingPermissions.size,
    };
  }

  /**
   * 获取治理统计
   */
  getStatistics() {
    const auditStats = governanceAuditService.getStatistics();
    return {
      ...auditStats,
      activeExecutions: this.state.activeExecutions.size,
      completedExecutions: this.state.completedExecutions.size,
      config: this.config,
      activeStrategy: governanceStrategyManager.getActiveStrategy()?.name || 'None',
    };
  }

  /**
   * 分析治理数据
   */
  analyzeGovernanceData() {
    const auditAnalysis = governanceAuditService.analyzeAuditData();
    const stats = this.getStatistics();
    
    return {
      stats,
      auditInsights: auditAnalysis.insights,
      activeStrategy: governanceStrategyManager.getActiveStrategy(),
      config: this.config,
    };
  }

  /**
   * 导出治理数据
   */
  exportGovernanceData(format = 'json') {
    const data = {
      config: this.config,
      statistics: this.getStatistics(),
      auditEvents: governanceAuditService.getRecentEvents(100),
      strategies: governanceStrategyManager.getStrategies(),
      state: this.getState(),
    };

    if (format === 'json') {
      return JSON.stringify(data, null, 2);
    }
    return data;
  }

  /**
   * 重置服务
   */
  reset() {
    this.state.activeExecutions.clear();
    this.state.completedExecutions.clear();
    this.state.pendingPermissions.clear();
    this.config = governanceConfigManager.getConfig();
    this.removeAllListeners();
    this.initialize();
  }
}

/**
 * 导出单例
 */
GovernanceManager.instance = new GovernanceManager();

export { GovernanceManager };
export const governanceManager = GovernanceManager.getInstance();
