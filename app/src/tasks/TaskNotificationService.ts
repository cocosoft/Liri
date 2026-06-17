import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { TaskNotifyPolicy, TaskDeliveryStatus, TaskStatus } from './types';
import type { TaskState, DeliveryRecord } from './types';
import type { SqliteTaskStore } from './db/SqliteTaskStore';

const logger = new Logger({ level: LogLevel.INFO });

export class TaskNotificationService {
  private policies: Map<string, TaskNotifyPolicy> = new Map();
  private deliveries: Map<string, DeliveryRecord> = new Map();
  private store: SqliteTaskStore | null;

  constructor(store?: SqliteTaskStore | null) {
    this.store = store ?? null;
  }

  /** 从 SQLite 加载投递记录 */
  async loadFromStore(): Promise<void> {
    if (!this.store) return;
    try {
      const records = await this.store.loadDeliveryRecords();
      for (const record of records) {
        this.deliveries.set(record.taskId, record);
      }
      logger.info('[TaskNotification] 从 SQLite 加载投递记录', {
        count: records.length,
      });
    } catch (error) {
      logger.warning('[TaskNotification] 从 SQLite 加载投递记录失败', {
        error,
      });
    }
  }

  registerPolicy(taskId: string, policy: TaskNotifyPolicy): void {
    this.policies.set(taskId, policy);
  }

  getPolicy(taskId: string): TaskNotifyPolicy | undefined {
    return this.policies.get(taskId);
  }

  async notify(taskId: string, state: TaskState): Promise<boolean> {
    const policy = this.policies.get(taskId);
    if (!policy || policy === TaskNotifyPolicy.SILENT) return false;

    if (policy === TaskNotifyPolicy.DONE_ONLY) {
      if (
        state.status !== TaskStatus.COMPLETED &&
        state.status !== TaskStatus.FAILED &&
        state.status !== TaskStatus.KILLED
      )
        return false;
    }

    if (policy === TaskNotifyPolicy.STATE_CHANGES) {
      const prev = this.deliveries.get(taskId);
      const newStatus = mapStateToDeliveryStatus(state);
      if (prev && prev.status === newStatus) return true;
    }

    const record: DeliveryRecord = {
      taskId,
      status: mapStateToDeliveryStatus(state),
      lastAttempt: Date.now(),
      attemptCount: 1,
    };

    this.deliveries.set(taskId, record);
    this.persist(record).catch((err) =>
      logger.warning('[TaskNotification] 持久化失败', { taskId, error: err })
    );
    return true;
  }

  getDeliveryStatus(taskId: string): TaskDeliveryStatus | undefined {
    return this.deliveries.get(taskId)?.status;
  }

  getDeliveries(): DeliveryRecord[] {
    return Array.from(this.deliveries.values());
  }

  async clearDelivery(taskId: string): Promise<void> {
    this.deliveries.delete(taskId);
    if (this.store) {
      await this.store.deleteDeliveryRecord(taskId).catch((err) =>
        logger.warning('[TaskNotification] 删除持久化记录失败', {
          taskId,
          error: err,
        })
      );
    }
  }

  /** 持久化投递记录到 SQLite */
  private async persist(record: DeliveryRecord): Promise<void> {
    if (!this.store) return;
    await this.store.saveDeliveryRecord(record);
  }
}

function mapStateToDeliveryStatus(state: TaskState): TaskDeliveryStatus {
  switch (state.status) {
    case TaskStatus.COMPLETED:
      return TaskDeliveryStatus.DELIVERED;
    case TaskStatus.FAILED:
      return TaskDeliveryStatus.FAILED;
    case TaskStatus.KILLED:
      return TaskDeliveryStatus.SKIPPED;
    default:
      return TaskDeliveryStatus.PENDING;
  }
}
