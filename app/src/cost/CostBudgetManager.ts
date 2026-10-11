/**
 * 成本预算管理器
 * 支持多维度预算设置、跟踪和告警
 */

import { formatCost } from './ModelPricing';
import { getCostMonitor, AlertLevel, type AlertRule } from './CostMonitor';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('cost:budgetManager');

/**
 * 预算周期类型
 */
export type BudgetPeriod = 'daily' | 'weekly' | 'monthly' | 'custom';

/**
 * 预算状态
 */
export type BudgetStatus = 'ok' | 'warning' | 'exceeded' | 'disabled';

/**
 * 预算配置
 */
export interface BudgetConfig {
  id: string;
  name: string;
  period: BudgetPeriod;
  limit: number; // 预算限额（美元）
  warningThreshold: number; // 警告阈值（百分比 0-1）
  hardLimit: boolean; // 是否启用硬限制
  enabled: boolean;
  customPeriodStart?: Date;
  customPeriodEnd?: Date;
}

/**
 * 预算状态信息
 */
export interface BudgetStatusInfo {
  budgetId: string;
  budgetName: string;
  period: BudgetPeriod;
  status: BudgetStatus;
  currentCost: number;
  limit: number;
  remaining: number;
  percentageUsed: number;
  periodStart: Date;
  periodEnd: Date;
  daysRemaining?: number;
  dailyRate?: number;
  estimatedEndCost?: number;
}

/**
 * 预算历史记录
 */
export interface BudgetHistoryEntry {
  period: string;
  budgetId: string;
  budgetName: string;
  limit: number;
  actualCost: number;
  status: BudgetStatus;
  startDate: Date;
  endDate: Date;
}

/**
 * 预算管理器
 */
export class CostBudgetManager {
  private budgets: Map<string, BudgetConfig> = new Map();
  private budgetHistory: BudgetHistoryEntry[] = [];
  private periodStartTimes: Map<string, number> = new Map();

  constructor() {
    this.loadDefaultBudgets();
  }

  /**
   * 加载默认预算配置
   */
  private loadDefaultBudgets(): void {
    const defaultBudgets: BudgetConfig[] = [
      {
        id: 'daily-budget',
        name: '每日预算',
        period: 'daily',
        limit: 50, // $50 per day
        warningThreshold: 0.8,
        hardLimit: false,
        enabled: true,
      },
      {
        id: 'weekly-budget',
        name: '每周预算',
        period: 'weekly',
        limit: 200, // $200 per week
        warningThreshold: 0.8,
        hardLimit: false,
        enabled: true,
      },
      {
        id: 'monthly-budget',
        name: '每月预算',
        period: 'monthly',
        limit: 800, // $800 per month
        warningThreshold: 0.8,
        hardLimit: false,
        enabled: true,
      },
    ];

    for (const budget of defaultBudgets) {
      this.budgets.set(budget.id, budget);
      this.initializePeriodStart(budget.id);
    }
  }

  /**
   * 初始化周期开始时间
   */
  private initializePeriodStart(budgetId: string): void {
    const budget = this.budgets.get(budgetId);
    if (!budget) return;

    const now = new Date();
    let start: Date;

    switch (budget.period) {
      case 'daily':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'weekly':
        const dayOfWeek = now.getDay();
        start = new Date(now);
        start.setDate(now.getDate() - dayOfWeek);
        break;
      case 'monthly':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'custom':
        start = budget.customPeriodStart || now;
        break;
    }

    this.periodStartTimes.set(budgetId, start.getTime());
  }

  /**
   * 添加预算配置
   */
  addBudget(config: BudgetConfig): void {
    this.budgets.set(config.id, config);
    this.initializePeriodStart(config.id);

    // 创建对应的告警规则
    this.createAlertRulesForBudget(config);
  }

  /**
   * 更新预算配置
   */
  updateBudget(budgetId: string, updates: Partial<BudgetConfig>): boolean {
    const budget = this.budgets.get(budgetId);
    if (!budget) return false;

    const updated = { ...budget, ...updates };
    this.budgets.set(budgetId, updated);

    if (updates.period || updates.limit) {
      this.initializePeriodStart(budgetId);
    }

    // 更新告警规则
    this.removeAlertRulesForBudget(budgetId);
    if (updated.enabled) {
      this.createAlertRulesForBudget(updated);
    }

    return true;
  }

  /**
   * 删除预算配置
   */
  removeBudget(budgetId: string): boolean {
    const existed = this.budgets.has(budgetId);
    if (existed) {
      this.budgets.delete(budgetId);
      this.periodStartTimes.delete(budgetId);
      this.removeAlertRulesForBudget(budgetId);
    }
    return existed;
  }

  /**
   * 获取预算配置
   */
  getBudget(budgetId: string): BudgetConfig | undefined {
    return this.budgets.get(budgetId);
  }

  /**
   * 获取所有预算配置
   */
  getBudgets(): BudgetConfig[] {
    return Array.from(this.budgets.values());
  }

  /**
   * 创建预算告警规则
   */
  private createAlertRulesForBudget(budget: BudgetConfig): void {
    if (!budget.enabled) return;

    const warningRule: AlertRule = {
      id: `budget-${budget.id}-warning`,
      name: `${budget.name} 警告`,
      level: AlertLevel.WARNING,
      thresholdType: 'cost',
      threshold: budget.limit * budget.warningThreshold,
      timeWindow: this.getPeriodDuration(budget.period),
      enabled: true,
    };

    const criticalRule: AlertRule = {
      id: `budget-${budget.id}-critical`,
      name: `${budget.name} 超额`,
      level: AlertLevel.CRITICAL,
      thresholdType: 'cost',
      threshold: budget.limit,
      timeWindow: this.getPeriodDuration(budget.period),
      enabled: true,
    };

    getCostMonitor().addRule(warningRule);
    getCostMonitor().addRule(criticalRule);
  }

  /**
   * 移除预算告警规则
   */
  private removeAlertRulesForBudget(budgetId: string): void {
    getCostMonitor().removeRule(`budget-${budgetId}-warning`);
    getCostMonitor().removeRule(`budget-${budgetId}-critical`);
  }

  /**
   * 获取周期持续时间（毫秒）
   */
  private getPeriodDuration(period: BudgetPeriod): number {
    switch (period) {
      case 'daily':
        return 24 * 60 * 60 * 1000;
      case 'weekly':
        return 7 * 24 * 60 * 60 * 1000;
      case 'monthly':
        return 30 * 24 * 60 * 60 * 1000; // 约30天
      case 'custom':
        return 24 * 60 * 60 * 1000; // 默认24小时
    }
  }

  /**
   * 获取周期结束时间
   */
  private getPeriodEnd(budget: BudgetConfig): Date {
    const start = new Date(this.periodStartTimes.get(budget.id) || Date.now());

    switch (budget.period) {
      case 'daily':
        return new Date(start.getTime() + 24 * 60 * 60 * 1000);
      case 'weekly':
        return new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
      case 'monthly':
        return new Date(start.getFullYear(), start.getMonth() + 1, 1);
      case 'custom':
        return (
          budget.customPeriodEnd ||
          new Date(start.getTime() + 24 * 60 * 60 * 1000)
        );
    }
  }

  /**
   * 获取预算状态（2026-10-11：因 `getPeriodCost` 改为按周期查 DB ⇒ 本方法转 async）
   */
  async getBudgetStatus(
    budgetId: string
  ): Promise<BudgetStatusInfo | undefined> {
    const budget = this.budgets.get(budgetId);
    if (!budget || !budget.enabled) {
      return {
        budgetId,
        budgetName: budget?.name || 'Unknown',
        period: budget?.period || 'daily',
        status: budget?.enabled ? 'ok' : 'disabled',
        currentCost: 0,
        limit: budget?.limit || 0,
        remaining: budget?.limit || 0,
        percentageUsed: 0,
        periodStart: new Date(),
        periodEnd: new Date(),
      };
    }

    const periodStart = new Date(
      this.periodStartTimes.get(budgetId) || Date.now()
    );
    const periodEnd = this.getPeriodEnd(budget);
    const currentCost = await this.getPeriodCost(budgetId);
    const remaining = budget.limit - currentCost;
    const percentageUsed = Math.min(100, (currentCost / budget.limit) * 100);

    let status: BudgetStatus = 'ok';
    if (percentageUsed >= 100) {
      status = 'exceeded';
    } else if (percentageUsed >= budget.warningThreshold * 100) {
      status = 'warning';
    }

    const now = new Date();
    const daysRemaining = Math.max(
      0,
      Math.ceil((periodEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
    );
    const elapsedDays = Math.max(
      1,
      Math.floor(
        (now.getTime() - periodStart.getTime()) / (24 * 60 * 60 * 1000)
      )
    );
    const dailyRate = currentCost / elapsedDays;
    const estimatedEndCost =
      dailyRate *
      ((periodEnd.getTime() - periodStart.getTime()) / (24 * 60 * 60 * 1000));

    return {
      budgetId,
      budgetName: budget.name,
      period: budget.period,
      status,
      currentCost,
      limit: budget.limit,
      remaining,
      percentageUsed,
      periodStart,
      periodEnd,
      daysRemaining,
      dailyRate,
      estimatedEndCost,
    };
  }

  /**
   * 获取所有预算状态（2026-10-11：随 `getBudgetStatus` 转 async）
   */
  async getAllBudgetStatuses(): Promise<BudgetStatusInfo[]> {
    const statuses: BudgetStatusInfo[] = [];

    for (const budget of this.budgets.values()) {
      const status = await this.getBudgetStatus(budget.id);
      if (status) {
        statuses.push(status);
      }
    }

    return statuses;
  }

  /**
   * 获取**周期内**成本（USD）。
   *
   * 2026-10-11（P7 / 阶段 5 修正）：原实现**忽略 `periodStart`**，直接返回
   * `costTracker.getTotalCostUSD()`（**全时累计**）⇒ daily/weekly/monthly 三档恒等且随总成本
   * 单调上升，`currentCost/remaining/percentageUsed/status` 全部**失真**。
   *
   * 现改为按 `periodStart` 查询 `CostRecordRepository.getAggregatedCosts({ startTime })`
   * （成本记录 DB 为唯一事实来源；该方法内部自带 `initDatabase()`，调用安全）。
   * 读取失败**不静默吞**（CS03-002）：记 warn 后向上抛，降级由调用方（HTTP 层既有 catch）决定。
   */
  private async getPeriodCost(budgetId: string): Promise<number> {
    const periodStart = this.periodStartTimes.get(budgetId);
    if (!periodStart) return 0;
    try {
      const { getCostRecordRepository } =
        await import('./CostRecordRepository.js');
      const agg = await getCostRecordRepository().getAggregatedCosts({
        startTime: periodStart,
      });
      return agg.totalCostUSD;
    } catch (error) {
      logger.warn('costBudgetManager:getPeriodCost — 读取周期成本失败', {
        budgetId,
        periodStart,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 检查是否超出硬限制（2026-10-11：随 `getBudgetStatus` 转 async）
   *
   * ⚠️ 当前**无生产调用方**（USD 预算为展示口径，未接入强制拦截）⇒ 异步化不影响任何闸门。
   */
  async isOverHardLimit(): Promise<boolean> {
    for (const budget of this.budgets.values()) {
      if (!budget.enabled || !budget.hardLimit) continue;

      const status = await this.getBudgetStatus(budget.id);
      if (status && status.status === 'exceeded') {
        return true;
      }
    }
    return false;
  }

  /**
   * 获取预算警告列表（2026-10-11：随 `getAllBudgetStatuses` 转 async）
   */
  async getBudgetWarnings(): Promise<BudgetStatusInfo[]> {
    return (await this.getAllBudgetStatuses()).filter(
      (s) => s.status === 'warning'
    );
  }

  /**
   * 获取已超额的预算列表（2026-10-11：随 `getAllBudgetStatuses` 转 async）
   */
  async getExceededBudgets(): Promise<BudgetStatusInfo[]> {
    return (await this.getAllBudgetStatuses()).filter(
      (s) => s.status === 'exceeded'
    );
  }

  /**
   * 记录预算历史（2026-10-11：因 `getPeriodCost` 转 async）
   */
  async recordHistory(budgetId: string, status: BudgetStatus): Promise<void> {
    const budget = this.budgets.get(budgetId);
    if (!budget) return;

    const entry: BudgetHistoryEntry = {
      period: budget.period,
      budgetId,
      budgetName: budget.name,
      limit: budget.limit,
      actualCost: await this.getPeriodCost(budgetId),
      status,
      startDate: new Date(this.periodStartTimes.get(budgetId) || Date.now()),
      endDate: this.getPeriodEnd(budget),
    };

    this.budgetHistory.push(entry);

    // 保持历史记录不超过100条
    if (this.budgetHistory.length > 100) {
      this.budgetHistory = this.budgetHistory.slice(-100);
    }
  }

  /**
   * 获取预算历史
   */
  getBudgetHistory(budgetId?: string): BudgetHistoryEntry[] {
    if (budgetId) {
      return this.budgetHistory.filter((h) => h.budgetId === budgetId);
    }
    return [...this.budgetHistory];
  }

  /**
   * 生成预算报告（2026-10-11：随状态查询链转 async）
   */
  async generateBudgetReport(): Promise<string> {
    const statuses = await this.getAllBudgetStatuses();

    let report = '\n========================================\n';
    report += '          预算状态报告\n';
    report += '========================================\n\n';

    for (const status of statuses) {
      report += `【${status.budgetName}】\n`;
      report += `  周期: ${this.getPeriodLabel(status.period)}\n`;
      report += `  状态: ${this.getStatusLabel(status.status)}\n`;
      report += `  当前成本: ${formatCost(status.currentCost)} / ${formatCost(status.limit)}\n`;
      report += `  已使用: ${status.percentageUsed.toFixed(1)}%\n`;
      report += `  剩余: ${formatCost(status.remaining)}\n`;

      if (status.daysRemaining !== undefined) {
        report += `  剩余天数: ${status.daysRemaining}天\n`;
      }

      if (status.dailyRate !== undefined) {
        report += `  日均消耗: ${formatCost(status.dailyRate)}/天\n`;
      }

      if (status.estimatedEndCost !== undefined) {
        report += `  预计期末成本: ${formatCost(status.estimatedEndCost)}\n`;
      }

      report += '\n';
    }

    const warnings = await this.getBudgetWarnings();
    const exceeded = await this.getExceededBudgets();

    if (warnings.length > 0) {
      report += `⚠️  ${warnings.length} 个预算接近阈值\n`;
    }

    if (exceeded.length > 0) {
      report += `🚨  ${exceeded.length} 个预算已超额\n`;
    }

    report += '========================================\n';

    return report;
  }

  private getPeriodLabel(period: BudgetPeriod): string {
    switch (period) {
      case 'daily':
        return '每日';
      case 'weekly':
        return '每周';
      case 'monthly':
        return '每月';
      case 'custom':
        return '自定义';
    }
  }

  private getStatusLabel(status: BudgetStatus): string {
    switch (status) {
      case 'ok':
        return '✅ 正常';
      case 'warning':
        return '⚠️ 警告';
      case 'exceeded':
        return '🚨 超额';
      case 'disabled':
        return '🔒 禁用';
    }
  }
}

/**
 * 全局预算管理器实例
 */
export const costBudgetManager = new CostBudgetManager();

/**
 * 添加预算配置
 */
export function addBudget(config: BudgetConfig): void {
  costBudgetManager.addBudget(config);
}

/**
 * 更新预算配置
 */
export function updateBudget(
  budgetId: string,
  updates: Partial<BudgetConfig>
): boolean {
  return costBudgetManager.updateBudget(budgetId, updates);
}

/**
 * 删除预算配置
 */
export function removeBudget(budgetId: string): boolean {
  return costBudgetManager.removeBudget(budgetId);
}

/**
 * 获取所有预算配置
 */
export function getBudgets(): BudgetConfig[] {
  return costBudgetManager.getBudgets();
}

/**
 * 获取预算状态（2026-10-11：转 async）
 */
export function getBudgetStatus(
  budgetId: string
): Promise<BudgetStatusInfo | undefined> {
  return costBudgetManager.getBudgetStatus(budgetId);
}

/**
 * 获取所有预算状态（2026-10-11：转 async）
 */
export function getAllBudgetStatuses(): Promise<BudgetStatusInfo[]> {
  return costBudgetManager.getAllBudgetStatuses();
}

/**
 * 检查是否超出硬限制（2026-10-11：转 async）
 */
export function isOverHardLimit(): Promise<boolean> {
  return costBudgetManager.isOverHardLimit();
}

/**
 * 生成预算报告（2026-10-11：转 async）
 */
export function generateBudgetReport(): Promise<string> {
  return costBudgetManager.generateBudgetReport();
}
