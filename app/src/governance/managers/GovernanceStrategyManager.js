/**
 * 治理策略管理服务
 * 提供治理策略的定义、管理和应用功能
 * 参考CC源码: cc_code/backend/utils/sandbox/sandbox-adapter.ts
 */

import { EventEmitter } from 'events';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { resolveGovernanceDir } from '@modules/config/paths';

/**
 * 治理策略管理服务类
 */
class GovernanceStrategyManager extends EventEmitter {
  constructor() {
    super();
    this.strategiesPath = this.getStrategiesPath();
    this.strategies = [];
    this.activeStrategyId = null;
    this.initialize();
  }

  /**
   * 获取单例实例
   */
  static getInstance() {
    if (!GovernanceStrategyManager.instance) {
      GovernanceStrategyManager.instance = new GovernanceStrategyManager();
    }
    return GovernanceStrategyManager.instance;
  }

  /**
   * 初始化
   */
  initialize() {
    // 确保目录存在
    this.ensureDirectories();
    // 加载策略
    this.strategies = this.loadStrategies();
    this.activeStrategyId = this.findActiveStrategy();
  }

  /**
   * 确保目录存在
   */
  ensureDirectories() {
    const strategiesDir = dirname(this.strategiesPath);
    if (!existsSync(strategiesDir)) {
      mkdirSync(strategiesDir, { recursive: true });
    }
  }

  /**
   * 获取策略文件路径
   */
  getStrategiesPath() {
    return join(resolveGovernanceDir(), 'governance_strategies.json');
  }

  /**
   * 加载策略
   */
  loadStrategies() {
    if (existsSync(this.strategiesPath)) {
      try {
        const content = readFileSync(this.strategiesPath, 'utf-8');
        const strategies = JSON.parse(content);
        return Array.isArray(strategies)
          ? strategies
          : this.createDefaultStrategies();
      } catch (error) {
        console.error('Failed to load governance strategies:', error);
        return this.createDefaultStrategies();
      }
    }
    return this.createDefaultStrategies();
  }

  /**
   * 创建默认策略
   */
  createDefaultStrategies() {
    const now = Date.now();
    const strategies = [
      {
        id: 'strict',
        name: '严格模式',
        type: 'strict',
        description: '最高安全级别，严格限制所有操作',
        rules: [
          {
            id: 'strict-1',
            type: 'permission',
            action: 'deny',
            target: 'BashTool',
            priority: 100,
            description: '默认拒绝Bash工具',
          },
          {
            id: 'strict-2',
            type: 'permission',
            action: 'deny',
            target: 'PowerShellTool',
            priority: 100,
            description: '默认拒绝PowerShell工具',
          },
          {
            id: 'strict-3',
            type: 'permission',
            action: 'deny',
            target: 'RunCommand',
            priority: 90,
            description: '默认拒绝命令执行工具',
          },
        ],
        createdAt: now,
        updatedAt: now,
        version: 1,
        isActive: false,
      },
      {
        id: 'balanced',
        name: '平衡模式',
        type: 'balanced',
        description: '平衡安全性和便利性',
        rules: [
          {
            id: 'balanced-1',
            type: 'permission',
            action: 'allow',
            target: 'Read',
            priority: 50,
            description: '允许读取文件',
          },
          {
            id: 'balanced-2',
            type: 'permission',
            action: 'monitor',
            target: 'Write',
            priority: 50,
            description: '监控写入操作',
          },
          {
            id: 'balanced-3',
            type: 'permission',
            action: 'allow',
            target: 'LS',
            priority: 40,
            description: '允许列出文件',
          },
          {
            id: 'balanced-4',
            type: 'permission',
            action: 'monitor',
            target: 'RunCommand',
            priority: 60,
            description: '监控命令执行',
          },
        ],
        createdAt: now,
        updatedAt: now,
        version: 1,
        isActive: true,
      },
      {
        id: 'permissive',
        name: '宽松模式',
        type: 'permissive',
        description: '最高便利性，最小安全限制',
        rules: [
          {
            id: 'permissive-1',
            type: 'permission',
            action: 'allow',
            target: '*',
            priority: 10,
            description: '允许所有工具',
          },
        ],
        createdAt: now,
        updatedAt: now,
        version: 1,
        isActive: false,
      },
      {
        id: 'development',
        name: '开发模式',
        type: 'custom',
        description: '适合开发环境的配置',
        rules: [
          {
            id: 'dev-1',
            type: 'permission',
            action: 'allow',
            target: 'Read',
            priority: 80,
            description: '允许读取文件',
          },
          {
            id: 'dev-2',
            type: 'permission',
            action: 'allow',
            target: 'Write',
            priority: 70,
            description: '允许写入文件',
          },
          {
            id: 'dev-3',
            type: 'permission',
            action: 'allow',
            target: 'BashTool',
            priority: 60,
            description: '允许Bash工具',
          },
          {
            id: 'dev-4',
            type: 'permission',
            action: 'allow',
            target: 'RunCommand',
            priority: 50,
            description: '允许命令执行',
          },
        ],
        createdAt: now,
        updatedAt: now,
        version: 1,
        isActive: false,
      },
    ];

    this.saveStrategies(strategies);
    return strategies;
  }

  /**
   * 保存策略
   */
  saveStrategies(strategies) {
    try {
      writeFileSync(
        this.strategiesPath,
        JSON.stringify(strategies, null, 2) + '\n'
      );
    } catch (error) {
      console.error('Failed to save governance strategies:', error);
    }
  }

  /**
   * 查找活跃策略
   */
  findActiveStrategy() {
    const active = this.strategies.find((s) => s.isActive);
    return active ? active.id : null;
  }

  /**
   * 获取所有策略
   */
  getStrategies() {
    return [...this.strategies];
  }

  /**
   * 获取策略
   */
  getStrategy(id) {
    return this.strategies.find((s) => s.id === id);
  }

  /**
   * 获取活跃策略
   */
  getActiveStrategy() {
    return this.activeStrategyId
      ? this.getStrategy(this.activeStrategyId)
      : undefined;
  }

  /**
   * 创建策略
   */
  createStrategy(strategy) {
    const now = Date.now();
    const newStrategy = {
      ...strategy,
      id: `strategy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    this.strategies.push(newStrategy);
    this.saveStrategies(this.strategies);

    this.emit('strategyEvent', {
      type: 'strategyCreated',
      strategyId: newStrategy.id,
      timestamp: now,
    });

    return newStrategy;
  }

  /**
   * 更新策略
   */
  updateStrategy(id, updates) {
    const index = this.strategies.findIndex((s) => s.id === id);

    if (index === -1) {
      return null;
    }

    const strategy = this.strategies[index];
    const updatedStrategy = {
      ...strategy,
      ...updates,
      updatedAt: Date.now(),
      version: strategy.version + 1,
    };

    this.strategies[index] = updatedStrategy;
    this.saveStrategies(this.strategies);

    this.emit('strategyEvent', {
      type: 'strategyUpdated',
      strategyId: id,
      timestamp: Date.now(),
    });

    return updatedStrategy;
  }

  /**
   * 激活策略
   */
  activateStrategy(id) {
    const strategy = this.getStrategy(id);

    if (!strategy) {
      return false;
    }

    // 先禁用所有策略
    this.strategies = this.strategies.map((s) => ({
      ...s,
      isActive: s.id === id,
    }));

    this.activeStrategyId = id;
    this.saveStrategies(this.strategies);

    this.emit('strategyEvent', {
      type: 'strategyActivated',
      strategyId: id,
      timestamp: Date.now(),
    });

    return true;
  }

  /**
   * 禁用策略
   */
  deactivateStrategy(id) {
    const strategy = this.getStrategy(id);

    if (!strategy) {
      return false;
    }

    const index = this.strategies.findIndex((s) => s.id === id);
    this.strategies[index] = {
      ...strategy,
      isActive: false,
      updatedAt: Date.now(),
    };

    if (this.activeStrategyId === id) {
      this.activeStrategyId = null;
    }

    this.saveStrategies(this.strategies);

    this.emit('strategyEvent', {
      type: 'strategyDeactivated',
      strategyId: id,
      timestamp: Date.now(),
    });

    return true;
  }

  /**
   * 删除策略
   */
  deleteStrategy(id) {
    const index = this.strategies.findIndex((s) => s.id === id);

    if (index === -1) {
      return false;
    }

    this.strategies.splice(index, 1);

    if (this.activeStrategyId === id) {
      this.activeStrategyId = null;
    }

    this.saveStrategies(this.strategies);

    return true;
  }

  /**
   * 应用策略规则
   */
  applyStrategyRules(target, context) {
    const activeStrategy = this.getActiveStrategy();

    if (!activeStrategy) {
      return 'allow';
    }

    // 按优先级排序规则
    const sortedRules = [...activeStrategy.rules].sort(
      (a, b) => b.priority - a.priority
    );

    for (const rule of sortedRules) {
      if (rule.target === '*' || rule.target === target) {
        // 检查条件
        if (rule.conditions) {
          const conditionsMet = Object.entries(rule.conditions).every(
            ([key, value]) => {
              return context[key] === value;
            }
          );

          if (conditionsMet) {
            return rule.action;
          }
        } else {
          return rule.action;
        }
      }
    }

    return 'allow';
  }

  /**
   * 批量应用策略规则
   */
  applyBatchRules(targets, context) {
    const results = {};
    for (const target of targets) {
      results[target] = this.applyStrategyRules(target, context);
    }
    return results;
  }

  /**
   * 导入策略
   */
  importStrategy(strategy) {
    const now = Date.now();
    const importedStrategy = {
      ...strategy,
      id: `strategy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: now,
      updatedAt: now,
      version: 1,
      isActive: false,
    };

    this.strategies.push(importedStrategy);
    this.saveStrategies(this.strategies);

    return importedStrategy;
  }

  /**
   * 导出策略
   */
  exportStrategy(id) {
    const strategy = this.getStrategy(id);
    if (!strategy) {
      return null;
    }
    return { ...strategy };
  }

  /**
   * 克隆策略
   */
  cloneStrategy(id, newName) {
    const strategy = this.getStrategy(id);
    if (!strategy) {
      return null;
    }

    const clonedStrategy = {
      ...strategy,
      id: `strategy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: newName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
      isActive: false,
    };

    this.strategies.push(clonedStrategy);
    this.saveStrategies(this.strategies);

    return clonedStrategy;
  }

  /**
   * 重置服务
   */
  reset() {
    this.strategies = this.createDefaultStrategies();
    this.activeStrategyId = this.findActiveStrategy();
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
GovernanceStrategyManager.instance = new GovernanceStrategyManager();

export { GovernanceStrategyManager };
export const governanceStrategyManager =
  GovernanceStrategyManager.getInstance();
