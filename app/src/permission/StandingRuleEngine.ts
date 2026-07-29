/**
 * StandingRuleEngine — 任务级永久工具批准（Standing Rules）
 *
 * P3-5: 对标 openworker task_rules {tool: {allowed targets}}。
 * 由 ScheduledTask 或 AlwaysOn 播种，运行时创建的新规则在下次检查中自动生效。
 *
 * 使用场景：自动化 cron 任务预先批准特定工具调用（如"允许向指定邮箱发送报告"），
 * 避免无人值守时触发审批阻塞。
 */
import { Logger } from '@modules/monitoring';

const logger = new Logger({ module: 'permission:standingRules' });

export interface StandingRule {
  toolName: string;
  allowedTargets: Set<string>;
  createdBy: string;     // task_id or 'manual'
  createdAt: number;
  expiresAt?: number;    // optional TTL
}

export interface RuleMatch {
  matched: boolean;
  rule?: StandingRule;
}

export class StandingRuleEngine {
  private rules = new Map<string, StandingRule>();

  /**
   * 添加一条 Standing Rule
   * @param toolName 工具名
   * @param target 允许的目标（如文件路径、邮箱地址）
   * @param taskId 关联的任务 ID
   * @param ttlMs 存活时间（ms），0 = 永久
   */
  addRule(
    toolName: string,
    target: string,
    taskId: string,
    ttlMs = 0
  ): void {
    const key = `${taskId}:${toolName}`;
    let rule = this.rules.get(key);
    if (!rule) {
      rule = {
        toolName,
        allowedTargets: new Set(),
        createdBy: taskId,
        createdAt: Date.now(),
      };
      this.rules.set(key, rule);
    }
    rule.allowedTargets.add(target);
    if (ttlMs > 0) rule.expiresAt = Date.now() + ttlMs;

    logger.info('standingRule:added', { toolName, target, taskId });
  }

  /**
   * 检查工具调用是否匹配任何 Standing Rule
   */
  checkPermission(
    toolName: string,
    target?: string
  ): RuleMatch {
    for (const rule of this.rules.values()) {
      // Check expiration
      if (rule.expiresAt && Date.now() > rule.expiresAt) {
        this.rules.delete(`${rule.createdBy}:${toolName}`);
        continue;
      }

      // Tool name match
      if (rule.toolName !== toolName) continue;

      // Target match (exact or wildcard '*')
      if (!target || rule.allowedTargets.has('*') || rule.allowedTargets.has(target)) {
        return { matched: true, rule };
      }
    }

    return { matched: false };
  }

  /**
   * 删除任务关联的所有规则
   */
  removeTaskRules(taskId: string): number {
    let removed = 0;
    for (const [key, rule] of this.rules) {
      if (rule.createdBy === taskId) {
        this.rules.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /**
   * 获取任务所有规则
   */
  getTaskRules(taskId: string): StandingRule[] {
    const result: StandingRule[] = [];
    for (const rule of this.rules.values()) {
      if (rule.createdBy === taskId) result.push(rule);
    }
    return result;
  }

  /**
   * 清理过期规则
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, rule] of this.rules) {
      if (rule.expiresAt && now > rule.expiresAt) {
        this.rules.delete(key);
        removed++;
      }
    }
    return removed;
  }

  get ruleCount(): number { return this.rules.size; }
}

/** P3-5: 全局单例 */
let _instance: StandingRuleEngine | null = null;

export function getStandingRuleEngine(): StandingRuleEngine {
  if (!_instance) _instance = new StandingRuleEngine();
  return _instance;
}
