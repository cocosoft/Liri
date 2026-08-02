import crypto from 'node:crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { configManager } from '@modules/config';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'chronos:ChronosRemoteTrigger',
  level: LogLevel.INFO,
});

const execAsync = promisify(exec);

export interface RemoteTriggerConfig {
  webhookUrl?: string;
  webhookSecret?: string;
  allowedEvents: string[];
  enabled: boolean;
}

export const DEFAULT_TRIGGER_CONFIG: RemoteTriggerConfig = {
  webhookUrl: configManager.env('CHRONOS_WEBHOOK_URL'),
  webhookSecret: configManager.env('CHRONOS_WEBHOOK_SECRET'),
  allowedEvents: ['push', 'schedule', 'manual'],
  enabled: configManager.env('CHRONOS_REMOTE_TRIGGER_ENABLED') === 'true',
};

export interface TriggerResult {
  success: boolean;
  taskId: string;
  triggeredAt: number;
  error?: string;
  durationMs: number;
}

export class ChronosRemoteTrigger {
  private config: RemoteTriggerConfig;
  private pendingTasks: Map<string, Promise<TriggerResult>> = new Map();

  constructor(config?: Partial<RemoteTriggerConfig>) {
    this.config = { ...DEFAULT_TRIGGER_CONFIG, ...config };
  }

  get isEnabled(): boolean {
    return this.config.enabled && !!this.config.webhookUrl;
  }

  async triggerTask(
    taskName: string,
    payload?: Record<string, unknown>
  ): Promise<TriggerResult> {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const startTime = Date.now();

    const attempt = async (): Promise<TriggerResult> => {
      try {
        const body = {
          event_type: 'manual',
          task_name: taskName,
          task_id: taskId,
          payload: payload || {},
          timestamp: Date.now(),
        };

        const signature = this.computeSignature(JSON.stringify(body));

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(this.config.webhookUrl!, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Chronos-Signature': signature,
            'X-Chronos-Task': taskName,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          return {
            success: false,
            taskId,
            triggeredAt: startTime,
            error: `HTTP ${response.status}: ${errorText}`,
            durationMs: Date.now() - startTime,
          };
        }

        return {
          success: true,
          taskId,
          triggeredAt: startTime,
          durationMs: Date.now() - startTime,
        };
      } catch (error) {
        return {
          success: false,
          taskId,
          triggeredAt: startTime,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
        };
      }
    };

    const promise = attempt();
    this.pendingTasks.set(taskId, promise);

    promise.finally(() => {
      this.pendingTasks.delete(taskId);
    });

    return promise;
  }

  async scheduleTask(
    taskName: string,
    cronExpression: string,
    payload?: Record<string, unknown>
  ): Promise<TriggerResult> {
    if (!this.isEnabled) {
      return {
        success: false,
        taskId: '',
        triggeredAt: Date.now(),
        error: 'Remote trigger not enabled',
        durationMs: 0,
      };
    }

    return this.triggerTask(taskName, {
      ...payload,
      cron_schedule: cronExpression,
      trigger_type: 'schedule',
    });
  }

  private computeSignature(payload: string): string {
    if (!this.config.webhookSecret) return '';

    return crypto
      .createHmac('sha256', this.config.webhookSecret)
      .update(payload)
      .digest('hex');
  }

  verifySignature(payload: string, signature: string): boolean {
    if (!this.config.webhookSecret) return true;

    const computed = this.computeSignature(payload);
    if (computed.length !== signature.length) return false;

    let result = 0;
    for (let i = 0; i < computed.length; i++) {
      result |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return result === 0;
  }

  getPendingTasks(): string[] {
    return Array.from(this.pendingTasks.keys());
  }
}

export class PushNotificationService {
  private enabled: boolean;

  constructor() {
    this.enabled = configManager.env('PUSH_NOTIFICATION_ENABLED') !== 'false';
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  async sendNotification(options: {
    title: string;
    body: string;
    urgency?: 'low' | 'normal' | 'critical';
    timeout?: number;
  }): Promise<boolean> {
    if (!this.enabled) return false;

    try {
      if (process.platform === 'win32') {
        return this.sendWindowsNotification(options);
      }
      if (process.platform === 'darwin') {
        return this.sendMacNotification(options);
      }
      return this.sendLinuxNotification(options);
    } catch {
      return false;
    }
  }

  private async sendWindowsNotification(options: {
    title: string;
    body: string;
    urgency?: string;
  }): Promise<boolean> {
    try {
      const escapedTitle = options.title.replace(/"/g, '\\"');
      const escapedBody = options.body.replace(/"/g, '\\"');
      const command = `powershell -Command "New-BurntToastNotification -Text '${escapedTitle}', '${escapedBody}'"`;
      await execAsync(command);
      return true;
    } catch {
      return false;
    }
  }

  private async sendMacNotification(options: {
    title: string;
    body: string;
    urgency?: string;
  }): Promise<boolean> {
    try {
      const escapedTitle = options.title.replace(/"/g, '\\"');
      const escapedBody = options.body.replace(/"/g, '\\"');
      const command = `osascript -e 'display notification "${escapedBody}" with title "${escapedTitle}"'`;
      await execAsync(command);
      return true;
    } catch {
      return false;
    }
  }

  private async sendLinuxNotification(options: {
    title: string;
    body: string;
    urgency?: string;
  }): Promise<boolean> {
    try {
      const urgencyArg = options.urgency ? `-u ${options.urgency}` : '';
      const command = `notify-send ${urgencyArg} "${options.title}" "${options.body}"`;
      await execAsync(command);
      return true;
    } catch {
      return false;
    }
  }

  async notifyTaskComplete(
    taskName: string,
    result: 'success' | 'failure',
    details?: string
  ): Promise<boolean> {
    const title = `Task ${result === 'success' ? 'Completed' : 'Failed'}: ${taskName}`;
    const body =
      details ||
      `Chronos task "${taskName}" has ${result === 'success' ? 'completed successfully' : 'failed'}.`;
    const urgency = result === 'failure' ? 'critical' : 'normal';

    return this.sendNotification({ title, body, urgency });
  }
}
