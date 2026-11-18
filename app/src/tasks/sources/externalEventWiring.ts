/**
 * externalEventWiring —— 外部事件来源的生产接线（D1，2026-11-14）
 *
 * 数据流（与 `fsWiring` 同构，不新建调度器/队列）：
 * ```
 * POST /v1/events/external（service 层 ExternalEventIntake：签名/去重/限速）
 *   → externalEventSource.emit
 *   → withPolicyGate（`autonomy.policy.sources.external === true`）
 *   → SourceRegistry（幂等 / 同线程串行）
 *   → ticketSink（trigger:<id> 工作项）→ ticketRunConsumer（可注入执行器）
 * ```
 *
 * 默认关：仅当 `autonomy.policy.sources.external === true` 时由 `alwaysOnEntry` 调用；
 * 未启用 ⇒ 不注册来源、不注入受理端口 ⇒ HTTP 端点回 503（零行为变更）。
 */
import { getLogger } from '@openliri/infra/monitoring';
import { configManager } from '@openliri/infra/config';
import {
  ExternalEventIntake,
  setExternalEventIntake,
} from '@openliri/service/runtime/externalEventIntake';

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
import {
  createGithubIssuePoller,
  readGithubIssuePollerConfig,
  type GithubIssue,
  type GithubIssuePollerConfig,
} from './githubIssuePoller';
import {
  createExternalEventSource,
  EXTERNAL_SOURCE_ID,
  type ExternalEventSource,
} from './externalEventSource';
import { withPolicyGate } from './policyGatedSource';
import { SourceRegistry } from './registry';
import { createTriggerTicketSink, type TicketSinkDeps } from './ticketSink';
import type { EventSource } from './types';

const logger = getLogger('tasks:external-source-wiring');

/** 签名密钥的环境变量名（唯一读取点；未配置 ⇒ 受理层 fail-closed 503） */
export const EXTERNAL_EVENT_SECRET_ENV = 'LIRI_EXTERNAL_EVENT_SECRET';

export interface ExternalEventPipelineOptions {
  store?: SourceCursorStore;
  readTicket?: TicketSinkDeps['read'];
  writeTicket?: TicketSinkDeps['write'];
  loadPolicy?: () => LoadedAutonomyPolicy;
  observePolicyChange?: (
    loaded: LoadedAutonomyPolicy
  ) => Promise<PolicyChangeDelivery | null>;
  /** 注入来源（测试；缺省 `createExternalEventSource()`） */
  source?: ExternalEventSource;
  /** 执行消费：宿主注入执行器（缺省 ⇒ 只记录、不执行） */
  executeTicket?: (
    ticket: Record<string, unknown>
  ) => Promise<TicketExecutionResult>;
  listWorkItems?: TicketRunConsumerOptions['listWorkItems'];
  claimWorkItem?: TicketRunConsumerOptions['claimWorkItem'];
  /** 签名密钥（测试注入；缺省读 env） */
  secret?: string;
  /**
   * D1 轮询（2026-11-18）：GitHub issue 配置。
   * 缺省 ⇒ 读 `autonomy.externalPollers.github` + `GITHUB_TOKEN`；传 `null` ⇒ **强制不启动**（测试用）。
   */
  githubPollerConfig?: GithubIssuePollerConfig | null;
  /** D1：拉取实现（测试注入；缺省走 GitHub REST） */
  githubFetchIssues?: (
    repo: string,
    sinceIso: string,
    token: string
  ) => Promise<GithubIssue[]>;
  now?: () => number;
}

export interface ExternalEventPipeline {
  sourceId: string;
  stop(): Promise<void>;
}

let shared: ExternalEventPipeline | null = null;

/**
 * 启动外部事件流水线（进程内单例；重复调用返回同一实例）。
 *
 * 失败向上抛：调用方（`alwaysOnEntry`）记录后继续，不影响 AlwaysOn。
 */
export async function startExternalEventPipeline(
  options: ExternalEventPipelineOptions = {}
): Promise<ExternalEventPipeline> {
  if (shared) return shared;

  const store = options.store ?? new SourceCursorStore();
  const read = options.readTicket ?? readPdcaWorkItem;
  const write = options.writeTicket ?? writePdcaWorkItem;
  const loadPolicy = options.loadPolicy ?? loadAutonomyPolicy;
  const sink = createTriggerTicketSink({
    read,
    write,
    execution: 'ticket',
    budget: () => resolveTicketBudgetLimits(loadPolicy().config),
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
      runConsumer();
    },
  });
  const source = options.source ?? createExternalEventSource();
  const gated = withPolicyGate(source, {
    loadPolicy: options.loadPolicy,
    observePolicyChange: options.observePolicyChange,
  });
  registry.register(gated as EventSource);
  await registry.start();

  const secret =
    options.secret ??
    configManager.env(EXTERNAL_EVENT_SECRET_ENV as never) ??
    '';
  const intake = new ExternalEventIntake({
    emit: (input) => source.emit(input),
    config: { secret },
    now: options.now,
  });
  setExternalEventIntake(intake);

  // D1 轮询（2026-11-18）：GitHub issue（默认关；无 token / 未启用 ⇒ 不启动）
  const pollerConfig =
    options.githubPollerConfig === undefined
      ? readGithubIssuePollerConfig()
      : options.githubPollerConfig;
  const poller = pollerConfig
    ? createGithubIssuePoller({
        config: pollerConfig,
        emit: (input) => source.emit(input),
        ...(options.githubFetchIssues
          ? { fetchIssues: options.githubFetchIssues }
          : {}),
        ...(options.now ? { now: options.now } : {}),
      })
    : null;
  poller?.start();

  // 启动恢复：上次遗留的 queued Ticket 也尝试消费一次
  runConsumer();

  logger.info('External Source 已启动', {
    sourceId: gated.id,
    secretConfigured: secret.length > 0,
    githubPoller: pollerConfig
      ? {
          repos: pollerConfig.repos.length,
          intervalMs: pollerConfig.intervalMs,
        }
      : null,
  });

  shared = {
    sourceId: gated.id,
    async stop() {
      poller?.stop();
      await registry.stop();
      setExternalEventIntake(null);
      if (!options.store) store.close();
      shared = null;
    },
  };
  return shared;
}

/** 测试/热重载：停止并释放单例（生产不调用） */
export async function stopExternalEventPipeline(): Promise<void> {
  await shared?.stop();
  shared = null;
}

export { EXTERNAL_SOURCE_ID };
