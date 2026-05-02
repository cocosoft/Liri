/**
 * 治理策略管理服务
 * 提供治理策略的定义、管理和应用功能
 * 参考CC源码: cc_code/backend/utils/sandbox/sandbox-adapter.ts
 */

import { EventEmitter } from 'events';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/**
 * 治理策略类型
 */
export type GovernanceStrategyType = 'strict' | 'balanced' | 'permissive' | 'custom';

/**
 * 治理策略
 */
export interface GovernanceStrategy {
  id: string;
  name: string;
  type: GovernanceStrategyType;
  description?: string;
  rules: GovernanceRule[];
  createdAt: number;
  updatedAt: number;
  version: number;
  isActive: boolean;
}

/**
 * 治理规则
 */
export interface GovernanceRule {
  id: string;
  type: 'permission' | 'sandbox' | 'hook';
  action: 'allow' | 'deny' | 'monitor';
  target: string;
  conditions?: Record<string, unknown>;
  priority: number;
  description?: string;
}

/**
 * 策略事件
 */
export interface StrategyEvent {
  type: 'strategyCreated' | 'strategyUpdated' | 'strategyActivated' | 'strategyDeactivated';
  strategyId: string;
  timestamp: number;
}

/**
 * 治理策略管理服务类
 */
export class GovernanceStrategyManager extends EventEmitter {
  private static instance: GovernanceStrategyManager;
  private strategiesPath: string;
  private strategies: GovernanceStrategy[] = [];
  private activeStrategyId: string | null = null;

  private constructor() {
    super();
    this.strategiesPath = this.getStrategiesPath();
    this.strategies = this.loadStrategies();
    this.activeStrategyId = this.findActiveStrategy();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): GovernanceStrategyManager {
    if (!GovernanceStrategyManager.instance) {
      GovernanceStrategyManager.instance = new GovernanceStrategyManager();
    }
    return GovernanceStrategyManager.instance;
  }

  /**
   * 获取策略文件路径
   */
  private getStrategiesPath(): string {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const strategiesDir = join(__dirname, '..', '..', '..', 'config', 'strategies');
    
    if (!existsSync(strategiesDir)) {
      mkdirSync(strategiesDir, { recursive: true });
    }
    
    return join(strategiesDir, 'governance_strategies.json');
  }

  /**
   * 加载策略
   */
  private loadStrategies(): GovernanceStrategy[] {
    if (existsSync(this.strategiesPath)) {
      try {
        const content = readFileSync(this.strategiesPath, 'utf-8');
        const strategies = JSON.parse(content);
        return Array.isArray(strategies) ? strategies : this.createDefaultStrategies();
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
  private createDefaultStrategies(): GovernanceStrategy[] {
    const now = Date.now();
    const strategies: GovernanceStrategy[] = [
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
    ];
    
    this.saveStrategies(strategies);
    return strategies;
  }

  /**
   * 保存策略
   */
  private saveStrategies(strategies: GovernanceStrategy[]): void {
    try {
      writeFileSync(this.strategiesPath, JSON.stringify(strategies, null, 2) + '\n');
    } catch (error) {
      console.error('Failed to save governance strategies:', error);
    }
  }

  /**
   * 查找活跃策略
   */
  private findActiveStrategy(): string | null {
    const active = this.strategies.find(s => s.isActive);
    return active ? active.id : null;
  }

  /**
   * 获取所有策略
   */
  getStrategies(): GovernanceStrategy[] {
    return [...this.strategies];
  }

  /**
   * 获取策略
   */
  getStrategy(id: string): GovernanceStrategy | undefined {
    return this.strategies.find(s => s.id === id);
  }

  /**
   * 获取活跃策略
   */
  getActiveStrategy(): GovernanceStrategy | undefined {
    return this.activeStrategyId ? this.getStrategy(this.activeStrategyId) : undefined;
  }

  /**
   * 创建策略
   */
  createStrategy(strategy: Omit<GovernanceStrategy, 'id' | 'createdAt' | 'updatedAt' | 'version'>): GovernanceStrategy {
    const now = Date.now();
    const newStrategy: GovernanceStrategy = {
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
  updateStrategy(id: string, updates: Partial<GovernanceStrategy>): GovernanceStrategy | null {
    const index = this.strategies.findIndex(s => s.id === id);
    
    if (index === -1) {
      return null;
    }

    const strategy = this.strategies[index];
    const updatedStrategy: GovernanceStrategy = {
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
  activateStrategy(id: string): boolean {
    const strategy = this.getStrategy(id);
    
    if (!strategy) {
      return false;
    }

    // 先禁用所有策略
    this.strategies = this.strategies.map(s => ({
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
  deactivateStrategy(id: string): boolean {
    const strategy = this.getStrategy(id);
    
    if (!strategy) {
      return false;
    }

    const index = this.strategies.findIndex(s => s.id === id);
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
  deleteStrategy(id: string): boolean {
    const index = this.strategies.findIndex(s => s.id === id);
    
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
  applyStrategyRules(target: string, context: Record<string, unknown>): 'allow' | 'deny' | 'monitor' {
    const activeStrategy = this.getActiveStrategy();
    
    if (!activeStrategy) {
      return 'allow';
    }

    // 按优先级排序规则
    const sortedRules = [...activeStrategy.rules].sort((a, b) => b.priority - a.priority);

    for (const rule of sortedRules) {
      if (rule.target === '*' || rule.target === target) {
        // 检查条件
        if (rule.conditions) {
          const conditionsMet = Object.entries(rule.conditions).every(([key, value]) => {
            return context[key] === value;
          });
          
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
   * 重置服务
   */
  reset(): void {
    this.strategies = this.createDefaultStrategies();
    this.activeStrategyId = this.findActiveStrategy();
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
export const governanceStrategyManager = GovernanceStrategyManager.getInstance();
