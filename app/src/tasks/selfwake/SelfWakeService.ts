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

/**
 * 阶段 A（N-26 修复）：会话唤醒执行器
 *
 * 由装配处注入（`ChatManager` 懒装配时注册），避免本模块直接依赖 chat 层造成循环依赖。
 * `fire()` 在标记 fired 后调用它，让被唤醒的会话**真正继续执行**。
 */
export type SelfWakeResumeHandler = (params: {
  sessionId: string;
  wakeId: string;
  kind: WakeKind;
  taskId: string;
  reason: string;
}) => Promise<{ ok: boolean; error?: string }>;

let selfWakeResumeHandler: SelfWakeResumeHandler | null = null;

/** 注册唤醒执行器（装配处调用；传 null 可卸载） */
export function setSelfWakeResumeHandler(
  handler: SelfWakeResumeHandler | null
): void {
  selfWakeResumeHandler = handler;
}

/** 供测试与观测：当前是否已装配唤醒执行器 */
export function hasSelfWakeResumeHandler(): boolean {
  return selfWakeResumeHandler !== null;
}

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

  /**
   * 标记已触发，并**真正唤醒会话**。
   *
   * 阶段 A（N-26 修复）：原实现只 `markFired`（"空唤醒"—— 对外表现为已唤醒，
   * 实际会话不会继续，与 `sessions_yield` 旧桩同属"假能力"家族）。现改为：
   * 解析条目 → 标记 fired → 调用装配的唤醒执行器（默认由 `ChatManager` 装配，
   * 内部消费一次 `streamMessage` 让会话续跑）。
   *
   * 未装配执行器时保持 fired 并记 warn（可观测，不静默丢唤醒）。
   */
  async fire(wakeId: string): Promise<void> {
    // 清理短时 timer
    const timer = this.shortTimers.get(wakeId);
    if (timer) {
      clearTimeout(timer);
      this.shortTimers.delete(wakeId);
    }

    const entry = await this._findEntry(wakeId);
    await this.wakeStore.markFired(wakeId);
    cg3Log('tasks:selfwake', 'info', 'fired', { wakeId });

    if (!entry) {
      cg3Log('tasks:selfwake', 'warn', 'fire:entry_not_found', { wakeId });
      return;
    }
    if (!selfWakeResumeHandler) {
      cg3Log('tasks:selfwake', 'warn', 'fire:resume_handler_absent', {
        wakeId,
        sessionId: entry.sessionId,
        kind: entry.kind,
      });
      return;
    }

    try {
      const res = await selfWakeResumeHandler({
        sessionId: entry.sessionId,
        wakeId,
        kind: entry.kind,
        taskId: entry.taskId,
        reason: `selfwake:${entry.kind}`,
      });
      if (!res.ok) {
        cg3Log('tasks:selfwake', 'warn', 'fire:resume_failed', {
          wakeId,
          sessionId: entry.sessionId,
          error: res.error ?? 'unknown',
        });
      } else {
        cg3Log('tasks:selfwake', 'info', 'fire:resumed', {
          wakeId,
          sessionId: entry.sessionId,
          kind: entry.kind,
        });
      }
    } catch (err) {
      cg3Log('tasks:selfwake', 'error', 'fire:resume_threw', {
        wakeId,
        error: String(err),
      });
    }
  }

  /** 按 wakeId 反查条目（sessionId 由 WakeStore 的内存索引提供） */
  private async _findEntry(wakeId: string): Promise<WakeEntry | null> {
    const sessionId = this.wakeStore.getSessionFor(wakeId);
    if (!sessionId) return null;
    const entries = await this.wakeStore.load(sessionId);
    return entries.find((e) => e.id === wakeId) ?? null;
  }

  /** 停止所有短时 timer（优雅关闭） */
  destroy(): void {
    for (const timer of this.shortTimers.values()) {
      clearTimeout(timer);
    }
    this.shortTimers.clear();
  }
}
