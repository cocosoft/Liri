/**
 * T1-13 / `✅-4`：执行域「PREPARED 快照」**durable 落盘** + 重放读回（2026-10-13）
 *
 * 见 `.trae/specs/execution-prepared-snapshot-persistence.md`。
 * 覆盖：
 * ① **落盘**：`emitPreparedSnapshot` 经既有 `eventSink` 追加 `execution/prepared`（去重 + 稳定排序）；
 * ② **非门控**：`STATE_PROJECTION_BROADCAST` 关（默认）时**仍落盘**（区别于四原语遥测广播）；
 * ③ **不臆造**：执行记录缺失 ⇒ **不落盘**（无 fake generation）；
 * ④ **读回**：`pickPreparedSnapshot` 取**最近一条**；无 ⇒ `null`；
 * ⑤ **接线（P-B）**：`selectAndObserveToolDefinitions` 在工具集定后落快照（可见集 = 裁剪后最终集）。
 */
import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import {
  getExecutionManager,
  emitPreparedSnapshot,
  pickPreparedSnapshot,
  setExecutionEventSink,
  type ExecutionId,
} from '../../src/execution/index.js';
import type { LiriEvent } from '../../src/session/types/events.js';
import { selectAndObserveToolDefinitions } from '../../src/chat/orchestrator/streamMessageToolSelectionFlow.js';
import type { ChatOrchestratorHost } from '../../src/chat/orchestrator/ChatOrchestrator.js';

const FLAG_ENV = 'FEATURE_STATE_PROJECTION_BROADCAST';

interface Captured {
  sessionId: string;
  type: string;
  data: Record<string, unknown>;
}

function capture(): Captured[] {
  const events: Captured[] = [];
  setExecutionEventSink(async (sessionId, event) => {
    events.push({
      sessionId,
      type: event.type,
      data: event.data as Record<string, unknown>,
    });
    return { ok: true, tailSeq: events.length };
  });
  return events;
}

beforeEach(() => {
  delete process.env[FLAG_ENV];
  getExecutionManager().reset();
});

afterAll(() => {
  setExecutionEventSink(null);
  getExecutionManager().reset();
  delete process.env[FLAG_ENV];
});

describe('T1-13 PREPARED 快照 durable 落盘', () => {
  it('落盘：去重 + 稳定排序；generation 由执行记录补齐', () => {
    const events = capture();
    const lease = getExecutionManager().acquire('s1');
    events.length = 0; // 丢弃 acquire 自身的 status_changed

    emitPreparedSnapshot({
      sessionId: 's1',
      executionId: lease.executionId,
      visibleTools: ['bash', 'read_vfs', 'bash'],
      taskType: 'coding',
    });

    const prepared = events.filter((e) => e.type === 'execution/prepared');
    expect(prepared.length).toBe(1);
    expect(prepared[0]!.sessionId).toBe('s1');
    expect(prepared[0]!.data).toEqual({
      executionId: lease.executionId,
      generation: lease.generation,
      visibleTools: ['bash', 'read_vfs'],
      taskType: 'coding',
    });
  });

  it('非门控：STATE_PROJECTION_BROADCAST 关（默认）时仍落盘', () => {
    delete process.env[FLAG_ENV];
    const events = capture();
    const lease = getExecutionManager().acquire('s2');
    events.length = 0;

    emitPreparedSnapshot({
      sessionId: 's2',
      executionId: lease.executionId,
      visibleTools: ['bash'],
    });

    expect(events.filter((e) => e.type === 'execution/prepared').length).toBe(
      1
    );
  });

  it('不臆造：执行记录缺失 ⇒ 不落盘（无 fake generation）', () => {
    const events = capture();
    emitPreparedSnapshot({
      sessionId: 's3',
      executionId: 'nope' as ExecutionId,
      visibleTools: ['bash'],
    });
    expect(events).toEqual([]);
  });

  it('读回：pickPreparedSnapshot 取最近一条；无 ⇒ null；忽略其它类型', () => {
    expect(pickPreparedSnapshot([])).toBeNull();
    const mk = (
      type: string,
      data: Record<string, unknown>,
      seq: number
    ): LiriEvent =>
      ({
        type,
        seq,
        time: 0,
        sessionId: 's',
        data,
      }) as unknown as LiriEvent;

    const older = mk(
      'execution/prepared',
      {
        executionId: 'e1',
        generation: 1,
        visibleTools: ['a'],
      },
      1
    );
    const newer = mk(
      'execution/prepared',
      {
        executionId: 'e2',
        generation: 2,
        visibleTools: ['b'],
      },
      3
    );
    const noise = mk('execution/status_changed', { to: 'RUNNING' }, 2);

    const picked = pickPreparedSnapshot([older, noise, newer]);
    expect(picked?.executionId).toBe('e2');
    expect(picked?.generation).toBe(2);
    expect(picked?.visibleTools).toEqual(['b']);
  });

  it('接线（P-B）：工具集定后落快照，可见集 = 裁剪后最终集；未下传 executionId ⇒ 不落', () => {
    const events = capture();
    const lease = getExecutionManager().acquire('s5');
    events.length = 0;

    const tools = [
      { function: { name: 'todo_write' } },
      { function: { name: 'agent' } },
    ];
    // 说明：`todo_write` / `agent` 属 MANDATORY_TOOLS ⇒ 任何 taskType 下均保留 ⇒ 最终集非空。
    const toolDefinitions = [...tools] as never;
    const host = {
      getClientForModel: () => ({}),
      toolRoundCount: 0,
    } as unknown as ChatOrchestratorHost;

    selectAndObserveToolDefinitions({
      toolDefinitions,
      session: { id: 's5' },
      options: { executionId: lease.executionId },
      host,
      apiMessages: [],
    } as never);

    const prepared = events.filter((e) => e.type === 'execution/prepared');
    expect(prepared.length).toBe(1);
    const finalNames = (
      toolDefinitions as unknown as { function?: { name?: string } }[]
    )
      .map((t) => t.function?.name ?? '')
      .filter((n) => n.length > 0);
    expect(prepared[0]!.data.visibleTools).toEqual(
      [...new Set(finalNames)].sort()
    );

    // 未下传 executionId ⇒ 无执行身份 ⇒ 如实不落（不臆造）
    const events2 = capture();
    getExecutionManager().acquire('s6');
    events2.length = 0;
    selectAndObserveToolDefinitions({
      toolDefinitions: [...tools] as never,
      session: { id: 's6' },
      options: {},
      host,
      apiMessages: [],
    } as never);
    expect(events2.filter((e) => e.type === 'execution/prepared').length).toBe(
      0
    );
  });
});
