/**
 * DeliveryManager 投递管理
 * 对标 OpenClaw 的投递系统
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';

const logger = getLogger('DeliveryManager');

/**
 * 投递方式
 */
export type DeliveryMethod =
  | 'console'
  | 'file'
  | 'webhook'
  | 'email'
  | 'channel';

/**
 * 投递计划
 */
export interface DeliveryPlan {
  id: string;
  taskId: string;
  method: DeliveryMethod;
  target: string;
  format: 'text' | 'json' | 'html';
  schedule: 'always' | 'on-success' | 'on-failure';
  template?: string;
}

/**
 * 投递结果
 */
export interface DeliveryResult {
  success: boolean;
  planId: string;
  method: DeliveryMethod;
  target: string;
  timestamp: number;
  error?: string;
}

/**
 * 投递管理器
 */
export class DeliveryManager {
  private plans: Map<string, DeliveryPlan> = new Map();

  /**
   * 注册投递计划
   */
  registerPlan(plan: DeliveryPlan): void {
    this.plans.set(plan.id, plan);
  }

  /**
   * 执行投递
   */
  async deliver(
    taskId: string,
    result: { success: boolean; output: string; error?: string }
  ): Promise<DeliveryResult[]> {
    const results: DeliveryResult[] = [];
    const relevantPlans = Array.from(this.plans.values()).filter(
      (p) => p.taskId === taskId
    );

    for (const plan of relevantPlans) {
      if (plan.schedule === 'on-success' && !result.success) continue;
      if (plan.schedule === 'on-failure' && result.success) continue;

      const deliveryResult = await this.executeDelivery(plan, result);
      results.push(deliveryResult);
    }

    return results;
  }

  /**
   * 预览投递内容
   */
  preview(plan: DeliveryPlan, result: { output: string }): string {
    const content = plan.template
      ? plan.template.replace('{{output}}', result.output)
      : result.output;

    return content;
  }

  /**
   * 执行单个投递
   */
  private async executeDelivery(
    plan: DeliveryPlan,
    result: { success: boolean; output: string; error?: string }
  ): Promise<DeliveryResult> {
    const content = this.preview(plan, result);

    switch (plan.method) {
      case 'console':
        logger.info('投递', { planId: plan.id, content });
        return {
          success: true,
          planId: plan.id,
          method: plan.method,
          target: plan.target,
          timestamp: Date.now(),
        };

      case 'file':
        try {
          const fs = await import('fs');
          fs.writeFileSync(plan.target, content, 'utf-8');
          return {
            success: true,
            planId: plan.id,
            method: plan.method,
            target: plan.target,
            timestamp: Date.now(),
          };
        } catch (err) {
          void handleError(err, {
            module: 'chronos:delivery',
            action: 'executeDelivery.file',
          });
          return {
            success: false,
            planId: plan.id,
            method: plan.method,
            target: plan.target,
            timestamp: Date.now(),
            error: err instanceof Error ? err.message : String(err),
          };
        }

      case 'webhook':
        try {
          const response = await fetch(plan.target, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content,
              taskId: plan.taskId,
              timestamp: Date.now(),
            }),
          });

          return {
            success: response.ok,
            planId: plan.id,
            method: plan.method,
            target: plan.target,
            timestamp: Date.now(),
          };
        } catch (err) {
          void handleError(err, {
            module: 'chronos:delivery',
            action: 'executeDelivery.webhook',
          });
          return {
            success: false,
            planId: plan.id,
            method: plan.method,
            target: plan.target,
            timestamp: Date.now(),
            error: err instanceof Error ? err.message : String(err),
          };
        }

      default:
        return {
          success: false,
          planId: plan.id,
          method: plan.method,
          target: plan.target,
          timestamp: Date.now(),
          error: `不支持的投递方式: ${plan.method}`,
        };
    }
  }
}

export const deliveryManager = new DeliveryManager();
