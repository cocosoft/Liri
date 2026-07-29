/**
 * SelfWakeService — 自唤醒核心服务
 *
 * P0-1: 双层精度触发机制
 *   - 短时 Timer（< tickInterval）：setTimeout 精确触发
 *   - 长时 Timer（≥ tickInterval）：CronScheduler.extra_tick 批量扫描
 */
import { randomUUID } from 'crypto';
import type { WakeEntry } from './types';
import { WakeKind } from './types';
import { WakeStore } from './WakeStore';
import { cg3Log } from '../cg3Env';
import { handleError } from '@modules/error';

export class SelfWakeService {
  private wakeStore: WakeStore;
  private tickIntervalMs: number;
  private shortTimers = new Map<string, NodeJS.Timeout>();

  constructor(wakeStore: WakeStore, tickIntervalMs = 300_000) {
    this.wakeStore = wakeStore;
    this.tickIntervalMs = tickIntervalMs;
  }

  /** Agent 挂起指定秒数 */
  async sleepFor(
    sessionId: string,
    taskId: string,
    seconds: number
  ): Promise<WakeEntry> {
    if (seconds > 86400) {
      throw new Error('sleep_for max is 24h (86400 seconds)');
    }

    const entry: WakeEntry = {
      id: randomUUID(),
      kind: WakeKind.TIMER,
      status: 'pending',
      sessionId,
      taskId,
      triggerAt: Date.now() + seconds * 1000,
      createdAt: Date.now(),
    };

    // 短时 Timer（< tickInterval）：直接 setTimeout 精确触发
    if (seconds * 1000 < this.tickIntervalMs) {
      const timer = setTimeout(() => {
        this.fire(entry.id).catch((err) => {
          handleError(err, {
            module: 'tasks:selfwake',
            action: 'shortTimerFire',
            context: { wakeId: entry.id },
          });
        });
      }, seconds * 1000);
      this.shortTimers.set(entry.id, timer);
    }

    await this.wakeStore.save(sessionId, [entry]);
    cg3Log('tasks:selfwake', 'info', 'sleepFor', {
      sessionId,
      taskId,
      seconds,
      wakeId: entry.id,
      shortTimer: seconds * 1000 < this.tickIntervalMs,
    });
    return entry;
  }

  /** Agent 挂起到指定时间 */
  async sleepUntil(
    sessionId: string,
    taskId: string,
    whenIso: string
  ): Promise<WakeEntry> {
    const when = new Date(whenIso).getTime();
    if (isNaN(when)) throw new Error(`Invalid ISO datetime: ${whenIso}`);
    const seconds = Math.ceil((when - Date.now()) / 1000);
    if (seconds < 0) throw new Error('sleep_until must be in the future');
    return this.sleepFor(sessionId, taskId, seconds);
  }

  /** 等待后台任务完成 */
  async wakeOnJob(
    sessionId: string,
    taskId: string,
    jobId: string
  ): Promise<WakeEntry> {
    const entry: WakeEntry = {
      id: randomUUID(),
      kind: WakeKind.COMPLETION,
      status: 'pending',
      sessionId,
      taskId,
      jobId,
      createdAt: Date.now(),
    };
    await this.wakeStore.save(sessionId, [entry]);
    cg3Log('tasks:selfwake', 'info', 'wakeOnJob', {
      sessionId,
      taskId,
      jobId,
      wakeId: entry.id,
    });
    return entry;
  }

  /** 等待 connector 事件 */
  async wakeOnEvent(
    sessionId: string,
    taskId: string,
    eventKey: string
  ): Promise<WakeEntry> {
    const entry: WakeEntry = {
      id: randomUUID(),
      kind: WakeKind.EVENT,
      status: 'pending',
      sessionId,
      taskId,
      eventKey,
      createdAt: Date.now(),
    };
    await this.wakeStore.save(sessionId, [entry]);
    cg3Log('tasks:selfwake', 'info', 'wakeOnEvent', {
      sessionId,
      taskId,
      eventKey,
      wakeId: entry.id,
    });
    return entry;
  }

  /** 获取到期应唤醒的条目（由 CronScheduler.extra_tick 调用） */
  async getDueWakes(): Promise<WakeEntry[]> {
    return this.wakeStore.getDueWakes();
  }

  /** 标记已触发 */
  async fire(wakeId: string): Promise<void> {
    // 清理短时 timer
    const timer = this.shortTimers.get(wakeId);
    if (timer) {
      clearTimeout(timer);
      this.shortTimers.delete(wakeId);
    }
    await this.wakeStore.markFired(wakeId);
    cg3Log('tasks:selfwake', 'info', 'fired', { wakeId });
  }

  /** 停止所有短时 timer（优雅关闭） */
  destroy(): void {
    for (const timer of this.shortTimers.values()) {
      clearTimeout(timer);
    }
    this.shortTimers.clear();
  }
}
