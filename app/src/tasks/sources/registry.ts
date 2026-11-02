/**
 * SourceRegistry —— 外部事件 → Trigger 的**唯一入口**（P35，2026-11-02）
 *
 * 方案：`dev_docs/20261102/Liri常驻自主执行升级方案-20261102.md` §5 P35。
 *
 * 职责（只做三件事，不做业务）：
 * 1. **幂等**：`triggerId` 由 `(source, externalId, type)` 确定性生成；重复投递只落一条；
 * 2. **位点**：`cursor` ≤ 已消费位点的事件直接跳过（重启不重放）；
 * 3. **串行**：同一 `ThreadKey` 同时只跑一个批次；期间到达的合并进下一批
 *    （对齐参考实现 `docs/001-domain.md:43`）。
 *
 * 诚实边界：
 * - 事件落库后交给 `handleTriggers`；处理失败**只记日志、不自动重投**（避免毒丸循环，
 *   Trigger 仍在 `source_triggers` 表里，可人工/后续批次补偿）；
 * - 不负责创建 Ticket 本身（由注入的处理方决定），本模块不 import 任何工单实现。
 */
import { getLogger } from '@openliri/infra/monitoring';

import type { SourceCursorStore } from './cursor';
import {
  toTrigger,
  type EventSource,
  type InboundEvent,
  type ThreadKey,
  type Trigger,
} from './types';

const logger = getLogger('tasks:source-registry');

/** 一批 Trigger 的处理函数（同线程内串行、跨线程并行） */
export type TriggerHandler = (
  threadKey: ThreadKey,
  triggers: readonly Trigger[]
) => Promise<void>;

export interface SourceRegistryOptions {
  store: SourceCursorStore;
  handleTriggers: TriggerHandler;
  /** 可注入时钟（测试用） */
  now?: () => number;
}

export class SourceRegistry {
  private readonly store: SourceCursorStore;
  private readonly handleTriggers: TriggerHandler;
  private readonly now: () => number;

  private readonly sources = new Map<string, EventSource>();
  private readonly disposers: Array<() => void> = [];
  /** 各线程待处理批次（去重后的事件） */
  private readonly pending = new Map<ThreadKey, Trigger[]>();
  /** 各线程是否有批次在跑（串行闸） */
  private readonly running = new Set<ThreadKey>();
  private started = false;

  constructor(options: SourceRegistryOptions) {
    this.store = options.store;
    this.handleTriggers = options.handleTriggers;
    this.now = options.now ?? Date.now;
  }

  /** 登记来源（`start()` 之前调用；id 重复或已启动 ⇒ 抛错，不做静默覆盖） */
  register(source: EventSource): void {
    if (this.started) {
      throw new Error('SourceRegistry: 已启动后不再接受新来源（请先 stop）');
    }
    if (this.sources.has(source.id)) {
      throw new Error(`SourceRegistry: 来源 id 重复: ${source.id}`);
    }
    this.sources.set(source.id, source);
  }

  /** 订阅全部来源（失败来源不影响其它来源，逐个留痕） */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    for (const source of this.sources.values()) {
      try {
        const dispose = await source.subscribe((event) => {
          void this.onEvent(source.id, event).catch((err) => {
            logger.warn('来源事件处理失败', {
              sourceId: source.id,
              error: String(err),
            });
          });
        });
        this.disposers.push(dispose);
      } catch (err) {
        logger.warn('来源订阅失败', {
          sourceId: source.id,
          error: String(err),
        });
      }
    }
  }

  /** 取消订阅（不等待在途批次；在途批次自行跑完并落库） */
  async stop(): Promise<void> {
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose();
      } catch (err) {
        logger.warn('来源取消订阅失败', { error: String(err) });
      }
    }
    this.started = false;
  }

  /**
   * 单条事件入口：位点过滤 → 幂等落库 → 入队。
   *
   * 位点过滤只对**提供了 `cursor`** 的来源生效；没提供时仅靠 `triggerId` 幂等。
   */
  private async onEvent(sourceId: string, event: InboundEvent): Promise<void> {
    if (event.cursor !== undefined) {
      const last = await this.store.readCursor(sourceId, event.threadKey);
      if (last !== undefined && event.cursor <= last) {
        return;
      }
    }

    const receivedAt = this.now();
    const trigger = toTrigger(sourceId, event, receivedAt);
    const inserted = await this.store.recordTriggerOnce(trigger);

    if (event.cursor !== undefined) {
      await this.store.writeCursor(
        sourceId,
        event.threadKey,
        event.cursor,
        receivedAt
      );
    }

    // 重复投递：台账里已有 ⇒ 不得再入队（"同一事件只生成一个工作项"）
    if (!inserted) return;
    this.enqueue(trigger);
  }

  private enqueue(trigger: Trigger): void {
    const batch = this.pending.get(trigger.threadKey) ?? [];
    batch.push(trigger);
    this.pending.set(trigger.threadKey, batch);
    if (!this.running.has(trigger.threadKey)) {
      void this.drain(trigger.threadKey);
    }
  }

  /** 串行消费一个线程：跑完当前批次后，把期间累积的 Trigger 合成**下一批** */
  private async drain(threadKey: ThreadKey): Promise<void> {
    this.running.add(threadKey);
    try {
      while (true) {
        const batch = this.pending.get(threadKey);
        if (!batch || batch.length === 0) break;
        this.pending.delete(threadKey);
        try {
          await this.handleTriggers(threadKey, batch);
        } catch (err) {
          logger.warn('Trigger 批次处理失败（不自动重投，台账保留）', {
            threadKey,
            triggerIds: batch.map((t) => t.triggerId),
            error: String(err),
          });
        }
      }
    } finally {
      this.running.delete(threadKey);
    }
  }
}
