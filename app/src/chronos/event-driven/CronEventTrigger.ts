import { EventEmitter } from 'node:events';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

export type TriggerEvent =
  | 'task.completed'
  | 'task.failed'
  | 'task.created'
  | 'session.created'
  | 'session.closed'
  | 'file.changed'
  | 'cron.tick';

export interface TriggerRule {
  id: string;
  event: TriggerEvent;
  filter?: (payload: unknown) => boolean;
  action: () => Promise<void>;
  description?: string;
}

export class CronEventTrigger extends EventEmitter {
  private rules: Map<string, TriggerRule> = new Map();

  registerRule(rule: TriggerRule): void {
    this.rules.set(rule.id, rule);
    const handler = async (payload: unknown) => {
      if (rule.filter && !rule.filter(payload)) return;
      try {
        await rule.action();
      } catch (e) {
        logger.error('[CronEventTrigger] 规则执行失败', {
          ruleId: rule.id,
          error: String(e),
        });
      }
    };
    this.on(rule.event, handler);
  }

  unregisterRule(ruleId: string): void {
    const rule = this.rules.get(ruleId);
    if (rule) {
      this.removeAllListeners(rule.event);
      this.rules.delete(ruleId);
    }
  }

  fire(event: TriggerEvent, payload?: unknown): void {
    this.emit(event, payload);
  }

  getRules(): TriggerRule[] {
    return Array.from(this.rules.values());
  }

  clear(): void {
    this.rules.clear();
    this.removeAllListeners();
  }
}

export const cronEventTrigger = new CronEventTrigger();
