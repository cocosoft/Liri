/**
 * Ticket 执行消费（P35，2026-11-02）
 *
 * 让 `execution='ticket'` 的 queued 工作项真正被**领取并执行**（此前只记录、不驱动）。
 *
 * 三条纪律：
 * 1. **默认不执行**：只有策略 `enabled=true && acceptMode==='auto'` 且注入了 `execute` 才跑；
 *    `observe/off/未启用` ⇒ 0 次执行（Ticket 保持 queued，行为与 P35 记录层一致）；
 * 2. **原子领取**：`claim(queued → active)` 单条条件 UPDATE ⇒ 多消费者只有一个成功；
 * 3. **串行**：一次 `runOnce` 顺序处理，避免同一进程并发打满模型/工具。
 *
 * 执行器由宿主注入（模型/会话/工具面归宿主决定）；失败只落 `failed + lastError`，不重试。
 */
import { getLogger } from '@openliri/infra/monitoring';

import {
  claimPdcaWorkItem,
  listPdcaWorkItems,
  readPdcaWorkItem,
  writePdcaWorkItem,
} from '../PdcaWorkItemBridge';
import { loadAutonomyPolicy, type LoadedAutonomyPolicy } from './policyConfig';
import { accumulateTicketUsage } from './ticketBudget';

const logger = getLogger('tasks:ticket-run-consumer');

export interface TicketExecutionResult {
  success: boolean;
  output?: string;
  /** 本轮 tokens（写入 budgetUsedTokens / costTokens） */
  tokens?: number;
  error?: string;
  /** 实际使用的会话（落回 Ticket，供接管/历史使用） */
  sessionId?: string;
}

export interface TicketRunConsumerOptions {
  listWorkItems?: () => Promise<ReadonlyArray<Record<string, unknown>>>;
  readWorkItem?: (
    workItemId: string
  ) => Promise<Record<string, unknown> | null>;
  claimWorkItem?: (
    workItemId: string,
    from: string,
    to: string
  ) => Promise<boolean>;
  writeWorkItem?: (record: Record<string, unknown>) => Promise<void>;
  loadPolicy?: () => LoadedAutonomyPolicy;
  /** 缺省 ⇒ 不执行（保持记录层行为） */
  execute?: (ticket: Record<string, unknown>) => Promise<TicketExecutionResult>;
  now?: () => number;
}

export interface TicketRunConsumer {
  /** 执行一轮（返回本轮实际执行数）；失败不抛，返回已完成的数量 */
  runOnce(): Promise<number>;
}

/** 该行是否为本消费者可执行的 Ticket */
function isExecutableTicket(row: Record<string, unknown>): boolean {
  return row.status === 'queued' && row.execution === 'ticket';
}

export function createTicketRunConsumer(
  options: TicketRunConsumerOptions = {}
): TicketRunConsumer {
  const list = options.listWorkItems ?? listPdcaWorkItems;
  const read = options.readWorkItem ?? readPdcaWorkItem;
  const claim = options.claimWorkItem ?? claimPdcaWorkItem;
  const write = options.writeWorkItem ?? writePdcaWorkItem;
  const loadPolicy = options.loadPolicy ?? loadAutonomyPolicy;
  const now = options.now ?? Date.now;
  const execute = options.execute;

  return {
    async runOnce() {
      // 未注入执行器 ⇒ 记录层模式（零模型调用）
      if (!execute) return 0;
      const loaded = loadPolicy();
      if (!loaded.config.enabled || loaded.config.acceptMode !== 'auto') {
        return 0;
      }

      let rows: ReadonlyArray<Record<string, unknown>>;
      try {
        rows = await list();
      } catch (error) {
        logger.warn('读取待执行 Ticket 失败（跳过本轮）', {
          error: String(error),
        });
        return 0;
      }

      let executed = 0;
      for (const row of rows) {
        if (!isExecutableTicket(row)) continue;
        const ticketId = typeof row.id === 'string' ? row.id : '';
        if (!ticketId) continue;

        // 原子领取：抢不到 ⇒ 别的消费者已接手
        if (!(await claim(ticketId, 'queued', 'active'))) continue;

        try {
          const result = await execute(row);
          const latest = (await read(ticketId)) ?? row;
          // P34 收尾：同一 Ticket 多次执行 ⇒ 累计（不覆盖上一轮用量）
          const usage = accumulateTicketUsage(latest, result.tokens ?? 0);
          await write({
            ...latest,
            id: ticketId,
            status: result.success ? 'completed' : 'failed',
            execution: 'ticket',
            ...(result.sessionId ? { sessionId: result.sessionId } : {}),
            ...(usage ?? {}),
            ...(result.output ? { output: result.output.slice(0, 2000) } : {}),
            ...(result.error ? { lastError: result.error } : {}),
            lastAction: 'ticket_executed',
            updatedAt: new Date(now()).toISOString(),
          });
          executed += 1;
          logger.info('Ticket 执行完成', {
            ticketId,
            success: result.success,
            tokens: result.tokens ?? 0,
          });
        } catch (error) {
          const latest = (await read(ticketId)) ?? row;
          await write({
            ...latest,
            id: ticketId,
            status: 'failed',
            execution: 'ticket',
            lastError: String(error),
            lastAction: 'ticket_executed',
            updatedAt: new Date(now()).toISOString(),
          });
          executed += 1;
          logger.warn('Ticket 执行抛错（已置 failed）', {
            ticketId,
            error: String(error),
          });
        }
      }
      return executed;
    },
  };
}
