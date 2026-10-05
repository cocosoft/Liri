// MIT License
// Copyright (c) 2026 190615273@qq.com
/**
 * 工作流运行期**集成**验证（P1-3 §10 + §12，2026-10-05 实建）
 *
 * 与单测的差别：使用**真实的** `DocOrchestrator` + `DocOrchestratorProvider` +
 * `WorkflowEngine` + `MessageToEventMigrator` + `EventLogStorage`（**真实文件落盘**）+
 * `EventMessageDeriver`；只有最外层"工具执行器"是边界替身（真实 doc/mail 工具依赖
 * MCP / OfficeCLI / 邮箱配置）。隔离：事件写入临时目录（`mkdtemp`），`afterAll` 清理。
 *
 * 覆盖：① 执行 → run 记录（steps 端回填）→ 投影 7 事件 → **真实落盘 + 磁盘回读**
 * ② 派生 → 单张 `workflow_run` 聚合卡片（completed，无 status 残留 —— D14）
 * ③ 取消（执行中）→ cancelled + 卡片 cancelled + 落盘含 cancelled
 * ④ 取消（调用前）→ 不执行任何步骤，仍发成对 start/end ⇒ 卡片 cancelled + 步骤全 pending
 */

import { describe, it, expect, afterAll } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  WorkflowEngine,
  createRunRecordCollector,
  type WorkflowRunRecord,
} from '../../../src/modules/workflow/index.js';
import { DocOrchestrator } from '../../../src/modules/doc/orchestration/DocOrchestrator.js';
import { DocOrchestratorProvider } from '../../../src/modules/doc/orchestration/DocOrchestratorProvider.js';
import { MessageToEventMigrator } from '../../../src/session/storage/MessageToEventMigrator.js';
import { EventLogStorage } from '../../../src/session/storage/EventLogStorage.js';
import { deriveMessagesFromEvents } from '../../../src/session/storage/EventMessageDeriver.js';
import type { LiriEvent } from '@modules/session/types/events';
import type { Message } from '@modules/session/types/message';

const WORKTREE = 'default';
/** 事件落盘根（隔离，避免污染真实 ~/.pyapp） */
const ROOT = mkdtempSync(join(tmpdir(), 'liri-wf-int-'));
const ANCHOR_ID = 'asst_wf_int_1';

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

type ToolExecutor = (
  tool: string,
  params: Record<string, unknown>
) => Promise<unknown>;

/** 轮询等待条件成立（带上限，避免竞态下无限等待） */
async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor 超时');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function setupEngine(executor?: ToolExecutor): WorkflowEngine {
  const orchestrator = new DocOrchestrator();
  orchestrator.setToolExecutor(
    executor ??
      (async (tool) => ({ status: 'success', output: `${tool} 完成` }))
  );
  const engine = new WorkflowEngine();
  engine.registerProvider(new DocOrchestratorProvider(orchestrator));
  return engine;
}

/** 把 run 记录经真实 migrator 投影为事件（seq 归一为 0 ⇒ 由 append 原子分配） */
function projectRun(record: WorkflowRunRecord): LiriEvent[] {
  const migrator = new MessageToEventMigrator(
    {} as unknown as ConstructorParameters<typeof MessageToEventMigrator>[0],
    'integration',
    WORKTREE
  );
  const { events } = migrator.convertMessage(
    {
      id: 'm1',
      role: 'tool',
      toolCallId: 'call_1',
      content: '工作流执行完成',
      metadata: { workflowRun: record },
    } as unknown as Message,
    1,
    Date.now()
  );
  return events.map((event) => ({ ...event, seq: 0 }));
}

/** 锚点助手消息 + run 投影 → 真实落盘（含 assistant/text 锚点，供富块归属） */
async function persistRun(
  sessionId: string,
  record: WorkflowRunRecord,
  anchorText: string
): Promise<{ log: EventLogStorage; diskEvents: LiriEvent[] }> {
  // EventLogStorage.append 对不存在的会话目录"跳过落盘"（不重建已删除会话）
  // ⇒ 真实落盘前须先建目录（生产路径由 POST /v1/sessions 建目录）
  mkdirSync(join(ROOT, WORKTREE, sessionId), { recursive: true });
  const log = new EventLogStorage(sessionId, WORKTREE, ROOT);
  await log.append({
    type: 'assistant/text',
    schemaVersion: 1,
    seq: 0,
    time: Date.now(),
    sessionId,
    data: { content: anchorText, messageId: ANCHOR_ID },
  } as LiriEvent);
  for (const event of projectRun(record)) {
    await log.append(event);
  }
  const diskEvents = await log.read();
  return { log, diskEvents };
}

/** 取派生消息里的工作流卡片数据 */
function cardOf(events: LiriEvent[]): Record<string, unknown> | undefined {
  const messages = deriveMessagesFromEvents(events, []);
  const anchor = messages.find((m) => m.id === ANCHOR_ID);
  const block = (anchor?.blocks ?? []).find((b) => b.type === 'workflow_run');
  return block?.workflowData as Record<string, unknown> | undefined;
}

/** 取派生消息里全部块类型（用于断言无 status 残留） */
function blockTypesOf(events: LiriEvent[]): string[] {
  const messages = deriveMessagesFromEvents(events, []);
  const anchor = messages.find((m) => m.id === ANCHOR_ID);
  return (anchor?.blocks ?? []).map((b) => String(b.type));
}

const WORKFLOW_EVENT_TYPES = [
  'assistant/workflow_run_start',
  'assistant/workflow_step_start',
  'assistant/workflow_step_end',
  'assistant/workflow_step_start',
  'assistant/workflow_step_end',
  'assistant/workflow_run_end',
];

describe('工作流运行期集成（真实 seam + 真实落盘 + 真实派生）', () => {
  it('执行 → run 记录 → 投影 7 事件 → 真实落盘 + 磁盘回读', async () => {
    const sessionId = 'session_wf_int_ok';
    const engine = setupEngine();
    const { observer, record } = createRunRecordCollector({});

    const result = await engine.execute('send-report', {}, { observer });

    expect(result.stopReason).toBe('completed');
    expect(result.completedSteps).toEqual(['doc:create-docx', 'mail:send']);
    expect(record.start?.workflow).toBe('send-report');
    expect(record.start?.steps).toEqual(['doc:create-docx', 'mail:send']);
    expect(record.end?.stopReason).toBe('completed');
    // D13 不变式：一次 run 结束时每个步骤的 end 必已回填
    expect(record.steps).toHaveLength(2);
    expect(record.steps?.every((s) => s.end !== undefined)).toBe(true);
    // 未走实时路径（无 sessionId）⇒ 批末投影兜底
    expect(record.liveEmitted).toBeUndefined();

    const { diskEvents } = await persistRun(
      sessionId,
      record,
      '好的，开始执行。'
    );

    // 真实落盘（磁盘原文）
    const raw = readFileSync(
      join(ROOT, WORKTREE, sessionId, 'events.jsonl'),
      'utf8'
    );
    expect(raw).toContain('assistant/workflow_run_start');
    expect(raw).toContain('assistant/workflow_step_end');
    expect(raw).toContain('assistant/workflow_run_end');
    expect(raw).toContain('send-report');

    // 磁盘回读：工作流事件按发生序（run 级 2 + 步骤 4）
    const workflowTypes = diskEvents
      .filter((e) => String(e.type).startsWith('assistant/workflow_'))
      .map((e) => String(e.type));
    expect(workflowTypes).toEqual(WORKFLOW_EVENT_TYPES);
  });

  it('历史回放派生为单张 workflow_run 卡片（D14；含步骤/描述/耗时；无 status 残留）', async () => {
    const sessionId = 'session_wf_int_card';
    const engine = setupEngine();
    const { observer, record } = createRunRecordCollector({});
    await engine.execute('send-report', {}, { observer });
    const { diskEvents } = await persistRun(
      sessionId,
      record,
      '好的，开始执行。'
    );

    const card = cardOf(diskEvents);
    expect(card).toBeDefined();
    expect(card!.workflow).toBe('send-report');
    expect(card!.status).toBe('completed');
    expect(card!.stopReason).toBe('completed');
    expect(typeof card!.durationMs).toBe('number');
    expect(card!.interruptedHint).toBeUndefined();

    const steps = card!.steps as Array<Record<string, unknown>>;
    expect(steps.map((s) => s.stepId)).toEqual([
      'doc:create-docx',
      'mail:send',
    ]);
    expect(steps.every((s) => s.status === 'completed')).toBe(true);
    expect(steps[0].description).toBe('创建文档');
    expect(steps[1].description).toBe('发送邮件（自动附加上一步创建的文档）');

    // 聚合后不再各产一条 status 提示行
    expect(blockTypesOf(diskEvents)).not.toContain('status');
  });

  it('取消（执行中）⇒ cancelled；卡片 cancelled；落盘含 cancelled；晚到上报被封闭丢弃', async () => {
    const sessionId = 'session_wf_int_cancel_mid';
    const calls: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const engine = setupEngine(async (tool) => {
      calls.push(tool);
      if (tool === 'doc:create-docx') await gate;
      return { status: 'success', output: `${tool} 完成` };
    });
    const { observer, record } = createRunRecordCollector({});
    const controller = new AbortController();

    const exec = engine.execute(
      'send-report',
      {},
      {
        observer,
        signal: controller.signal,
        gracePeriodMs: 20,
      }
    );
    // 等第一步开始（start 已上报）后中止
    await waitFor(() => record.steps?.length === 1);
    controller.abort();
    const result = await exec;

    expect(result.stopReason).toBe('cancelled');
    expect(record.end?.stopReason).toBe('cancelled');
    // 被放弃的步骤由账本强制结算（synthesized + cancelled）
    expect(record.steps).toHaveLength(1);
    expect(record.steps?.[0].end?.synthesized).toBe(true);
    expect(record.steps?.[0].end?.outcome).toBe('cancelled');

    // 释放后台 Provider：其后续上报（step1 end / step2 start）应被封闭账本丢弃
    release();
    await waitFor(() => calls.length >= 2);
    expect(calls).toEqual(['doc:create-docx', 'mail:send']);
    expect(record.steps).toHaveLength(1);

    const { diskEvents } = await persistRun(
      sessionId,
      record,
      '好的，开始执行（将被取消）。'
    );
    const raw = readFileSync(
      join(ROOT, WORKTREE, sessionId, 'events.jsonl'),
      'utf8'
    );
    expect(raw).toContain('"stopReason":"cancelled"');

    const card = cardOf(diskEvents);
    expect(card!.status).toBe('cancelled');
  });

  it('取消（调用前）⇒ 不执行任何步骤，仍发成对 start/end（卡片 cancelled + 步骤全 pending）', async () => {
    const sessionId = 'session_wf_int_cancel_pre';
    const calls: string[] = [];
    const engine = setupEngine(async (tool) => {
      calls.push(tool);
      return { status: 'success', output: `${tool} 完成` };
    });
    const { observer, record } = createRunRecordCollector({});
    const controller = new AbortController();
    controller.abort();

    const result = await engine.execute(
      'send-report',
      {},
      {
        observer,
        signal: controller.signal,
      }
    );

    expect(result.stopReason).toBe('cancelled');
    expect(calls).toHaveLength(0);
    expect(record.start?.steps).toEqual(['doc:create-docx', 'mail:send']);
    expect(record.end?.stopReason).toBe('cancelled');
    expect(record.steps).toHaveLength(0);

    const { diskEvents } = await persistRun(
      sessionId,
      record,
      '好的，开始执行（开始前已取消）。'
    );
    // 计划步骤仍完整投影（run 级 2 条 + 无步骤事件）
    const workflowTypes = diskEvents
      .filter((e) => String(e.type).startsWith('assistant/workflow_'))
      .map((e) => String(e.type));
    expect(workflowTypes).toEqual([
      'assistant/workflow_run_start',
      'assistant/workflow_run_end',
    ]);

    const card = cardOf(diskEvents);
    expect(card!.status).toBe('cancelled');
    const steps = card!.steps as Array<Record<string, unknown>>;
    expect(steps.map((s) => s.status)).toEqual(['pending', 'pending']);
  });
});
