import { EventEmitter } from 'events';
import { getLogger } from '@openliri/infra/monitoring';
import { handleError } from '@openliri/infra/error/handleError';

const logger = getLogger('chronos:event');

/** 观察期日志（每进程一次；不改变任何行为） */
let deprecatedWarned = false;
function warnDeprecatedOnce(): void {
  if (deprecatedWarned) return;
  deprecatedWarned = true;
  process.emitWarning(
    'chronos.CronEventTrigger 属未接线旧轨（P35）；新入口请用 app/src/tasks/sources。',
    { type: 'DeprecationWarning', code: 'LIRI_CHRONOS_LEGACY_TRIGGER' }
  );
}

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

/**
 * @deprecated P35（2026-11-02）：**未接线的旧轨雏形**，全仓无运行时消费者。
 *
 * 唯一入口是新 `app/src/tasks/sources`（Source → Trigger → Ticket）；本类仅保留供
 * 观察期取证（CD05/CD06：先标记、不删除）。首次实例化会发一条 `DeprecationWarning`，
 * 用于确认是否仍有入口在用它；观察期结束且零告警后再评估删除。
 */
export class CronEventTrigger extends EventEmitter {
  private rules: Map<string, TriggerRule> = new Map();

  constructor() {
    super();
    warnDeprecatedOnce();
  }

  registerRule(rule: TriggerRule): void {
    this.rules.set(rule.id, rule);
    const handler = async (payload: unknown) => {
      if (rule.filter && !rule.filter(payload)) return;
      try {
        await rule.action();
      } catch (e) {
        void handleError(e, { module: 'chronos:event', action: 'ruleAction' });
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
