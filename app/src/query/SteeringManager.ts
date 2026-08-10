/**
 * SteeringManager — 中轮消息注入（Steering）
 *
 * P1-10: 对标 openworker queue_steering + hermes-agent STEER_CHANNEL_NOTE。
 * 允许在 Agent ReAct 循环中插入外部指令（用户中途喊停、Cron 触发通知等）。
 *
 * 两处注入点（对标 openworker TurnEngine._loop）：
 *   A: 模型完成文本回答但无 tool_calls 时
 *   B: 一轮所有 tool_calls 执行完毕后
 */

import { getLogger } from '@modules/monitoring';
const logger = getLogger('query:steering');

export interface SteeringMessage {
  text: string;
  source?: string;
  timestamp: number;
}

export class SteeringManager {
  private queue: SteeringMessage[] = [];
  private maxQueueSize: number;

  constructor(maxQueueSize = 10) {
    this.maxQueueSize = maxQueueSize;
  }

  /**
   * 排队一条中轮指令（外部可随时调用）
   * @returns false 如果队列已满
   */
  queueSteering(text: string, source?: string): boolean {
    if (this.queue.length >= this.maxQueueSize) {
      logger.warn('steering:queue_full', { maxSize: this.maxQueueSize });
      return false;
    }
    this.queue.push({ text, source, timestamp: Date.now() });
    return true;
  }

  /** 是否有待注入的指令 */
  hasPending(): boolean {
    return this.queue.length > 0;
  }

  /** 数量 */
  get pendingCount(): number {
    return this.queue.length;
  }

  /**
   * 消费所有待注入指令，清空队列。
   * 返回格式化的注入消息（role="user" 格式）
   */
  consumeAll(): Array<{ role: 'user'; content: string; source?: string }> {
    if (this.queue.length === 0) return [];

    const messages = this.queue.map((m) => {
      const prefix = '[OUT-OF-BAND USER MESSAGE]';
      const content = m.source
        ? `<steering source="${m.source}">\n${prefix}\n${m.text}\n</steering>`
        : `<steering>\n${prefix}\n${m.text}\n</steering>`;
      return { role: 'user' as const, content, source: m.source };
    });

    this.queue = [];
    logger.info('steering:injected', { count: messages.length });
    return messages;
  }

  /** 清空（不注入） */
  clear(): void {
    this.queue = [];
  }
}

/** 全局单例 */
let _globalSteering: SteeringManager;

export function getGlobalSteeringManager(): SteeringManager {
  if (!_globalSteering) _globalSteering = new SteeringManager();
  return _globalSteering;
}
