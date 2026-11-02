/**
 * fsSignalSource 生产接线（P35，2026-11-02）
 *
 * 方案：`dev_docs/20261102/Liri常驻自主执行升级方案-20261102.md` §5 **P35**。
 *
 * 数据流：
 * ```
 * SignalWatcher（项目目录文件变更）
 *   → fsSignalSource: {path, kind} → InboundEvent（线程 = fs:<path>，位点 = at）
 *   → withPolicyGate: 准入判定（P33；未启用 ⇒ 透传）
 *   → SourceRegistry: 位点过滤 / 幂等 / 同路径串行
 *   → ticketSink: trigger:<id> Ticket（queued）
 * ```
 *
 * 诚实边界（本阶段）：
 * - 文件事件只**记录 Ticket**，不触发执行（执行器接入是后续阶段）；
 * - 生产注册由 `alwaysOnEntry` 在 `autonomy.policy.sources.fs === true` 时调用
 *   （默认 `false` ⇒ 零行为变更）；路径在启动时快照，运行中新增项目需重启生效。
 */
import { getLogger } from '@openliri/infra/monitoring';

import {
  loadAutonomyPolicy,
  resolveTicketBudgetLimits,
  type LoadedAutonomyPolicy,
} from '../autonomy/policyConfig';
import type { PolicyChangeDelivery } from '../autonomy/policyChange';
import {
  createTicketRunConsumer,
  type TicketExecutionResult,
  type TicketRunConsumerOptions,
} from '../autonomy/ticketRunConsumer';
import { readPdcaWorkItem, writePdcaWorkItem } from '../PdcaWorkItemBridge';
import { SourceCursorStore } from './cursor';
import { createFsSignalSource, type FsSignalSource } from './fsSignalSource';
import { withPolicyGate } from './policyGatedSource';
import { SourceRegistry } from './registry';
import { createTriggerTicketSink, type TicketSinkDeps } from './ticketSink';
import type { EventSource } from './types';

const logger = getLogger('tasks:fs-source-wiring');

export interface FsSignalPipelineOptions {
  watchPaths: string[];
  store?: SourceCursorStore;
  readTicket?: TicketSinkDeps['read'];
  writeTicket?: TicketSinkDeps['write'];
  loadPolicy?: () => LoadedAutonomyPolicy;
  observePolicyChange?: (
    loaded: LoadedAutonomyPolicy
  ) => Promise<PolicyChangeDelivery | null>;
  /** 注入来源（测试；缺省 `createFsSignalSource({ watchPaths })`） */
  source?: EventSource & { stop?: () => void };
  /** P35 执行消费：宿主注入执行器（缺省 ⇒ 只记录、不执行） */
  executeTicket?: (
    ticket: Record<string, unknown>
  ) => Promise<TicketExecutionResult>;
  /** 执行消费的读/领取（测试注入；缺省走 workitems） */
  listWorkItems?: TicketRunConsumerOptions['listWorkItems'];
  claimWorkItem?: TicketRunConsumerOptions['claimWorkItem'];
  now?: () => number;
}

export interface FsSignalPipeline {
  sourceId: string;
  stop(): Promise<void>;
}

let shared: FsSignalPipeline | null = null;

/**
 * 启动文件信号流水线（进程内单例；重复调用返回同一实例）。
 *
 * 失败向上抛：调用方（`alwaysOnEntry`）记录后继续，不影响 AlwaysOn。
 */
export async function startFsSignalPipeline(
  options: FsSignalPipelineOptions
): Promise<FsSignalPipeline> {
  if (shared) return shared;

  const store = options.store ?? new SourceCursorStore();
  const read = options.readTicket ?? readPdcaWorkItem;
  const write = options.writeTicket ?? writePdcaWorkItem;
  const loadPolicy = options.loadPolicy ?? loadAutonomyPolicy;
  const sink = createTriggerTicketSink({
    read,
    write,
    // fs 无外部执行器 ⇒ Ticket 交给消费者
    execution: 'ticket',
    // P34 收尾：预算上限来自 `autonomy.policy.budget`（缺省 = 不设上限）
    budget: () => resolveTicketBudgetLimits(loadPolicy().config),
    annotate: (trigger) => {
      const policyId = trigger.payload.policyId;
      if (typeof policyId !== 'string' || !policyId) return undefined;
      const mandate = trigger.payload.mandate;
      return {
        policyId,
        ...(mandate && typeof mandate === 'object' ? { mandate } : {}),
      };
    },
  });

  const consumer = createTicketRunConsumer({
    listWorkItems: options.listWorkItems,
    claimWorkItem: options.claimWorkItem,
    readWorkItem: read,
    writeWorkItem: write,
    loadPolicy: options.loadPolicy,
    execute: options.executeTicket,
    now: options.now,
  });
  const runConsumer = (): void => {
    void consumer.runOnce().catch((error) => {
      logger.warn('Ticket 执行消费失败（不阻断来源）', {
        error: String(error),
      });
    });
  };

  const registry = new SourceRegistry({
    store,
    handleTriggers: async (threadKey, triggers) => {
      await sink(threadKey, triggers);
      // 建完 Ticket 立即尝试消费（串行、原子领取；非 auto ⇒ 内部直接返回）
      runConsumer();
    },
  });
  const base =
    options.source ?? createFsSignalSource({ watchPaths: options.watchPaths });
  const gated = withPolicyGate(base, {
    loadPolicy: options.loadPolicy,
    observePolicyChange: options.observePolicyChange,
  });
  registry.register(gated);
  await registry.start();

  // 启动恢复：上次进程遗留的 queued Ticket 也尝试消费一次
  runConsumer();

  logger.info('FS Source 已启动', {
    sourceId: gated.id,
    watchPaths: options.watchPaths.length,
  });

  shared = {
    sourceId: gated.id,
    async stop() {
      await registry.stop();
      (base as FsSignalSource).stop?.();
      if (!options.store) store.close();
      shared = null;
    },
  };
  return shared;
}

/** 测试/热重载：停止并释放单例（生产不调用） */
export async function stopFsSignalPipeline(): Promise<void> {
  await shared?.stop();
  shared = null;
}
