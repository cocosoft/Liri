import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { TaskStatus } from './types';
import type { TaskState } from './types';
import {
  DeliveryManager,
  type DeliveryPlan,
  type DeliveryResult,
} from '../chronos/delivery/DeliveryManager';

const logger = new Logger({ level: LogLevel.INFO });

export interface TaskDeliveryConfig {
  taskId: string;
  onSuccess?: Partial<DeliveryPlan>;
  onFailure?: Partial<DeliveryPlan>;
}

export class TaskDeliveryAdapter {
  private deliveryManager: DeliveryManager;
  private configs: Map<string, TaskDeliveryConfig> = new Map();

  constructor(deliveryManager?: DeliveryManager) {
    this.deliveryManager = deliveryManager ?? new DeliveryManager();
  }

  register(taskId: string, config: TaskDeliveryConfig): void {
    this.configs.set(taskId, config);

    if (config.onSuccess) {
      const plan: DeliveryPlan = {
        id: `${taskId}-success`,
        taskId,
        method: config.onSuccess.method ?? 'console',
        target: config.onSuccess.target ?? 'local',
        format: config.onSuccess.format ?? 'json',
        schedule: config.onSuccess.schedule ?? 'on-success',
        template: config.onSuccess.template,
      };
      this.deliveryManager.registerPlan(plan);
    }

    if (config.onFailure) {
      const plan: DeliveryPlan = {
        id: `${taskId}-failure`,
        taskId,
        method: config.onFailure.method ?? 'console',
        target: config.onFailure.target ?? 'local',
        format: config.onFailure.format ?? 'text',
        schedule: config.onFailure.schedule ?? 'on-failure',
        template: config.onFailure.template,
      };
      this.deliveryManager.registerPlan(plan);
    }
  }

  async deliverTask(
    taskId: string,
    state: TaskState
  ): Promise<DeliveryResult[]> {
    const isSuccess = state.status === TaskStatus.COMPLETED;
    return this.deliveryManager.deliver(taskId, {
      success: isSuccess,
      output: JSON.stringify(state),
      error: state.error,
    });
  }

  async notifyFailure(
    taskId: string,
    state: TaskState,
    reason: string
  ): Promise<void> {
    const config = this.configs.get(taskId);
    if (!config) {
      logger.warn('[TaskDelivery] 未注册投递配置', { taskId });
      return;
    }

    logger.error('[TaskDelivery] 任务失败通知', {
      taskId,
      status: state.status,
      reason,
    });

    await this.deliveryManager.deliver(taskId, {
      success: false,
      output: JSON.stringify(state),
      error: reason,
    });
  }

  getDeliveryManager(): DeliveryManager {
    return this.deliveryManager;
  }
}
