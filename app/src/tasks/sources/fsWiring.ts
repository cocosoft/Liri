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
  type LoadedAutonomyPolicy,
} from '../autonomy/policyConfig';
import type { PolicyChangeDelivery } from '../autonomy/policyChange';
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
  const sink = createTriggerTicketSink({
    read,
    write,
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

  const registry = new SourceRegistry({ store, handleTriggers: sink });
  const base =
    options.source ?? createFsSignalSource({ watchPaths: options.watchPaths });
  const gated = withPolicyGate(base, {
    loadPolicy: options.loadPolicy,
    observePolicyChange: options.observePolicyChange,
  });
  registry.register(gated);
  await registry.start();

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
