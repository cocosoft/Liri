// MIT License
// Copyright (c) 2026 190615273@qq.com
/**
 * N-26 修复测试：`SelfWakeService.fire()` 不再是"空唤醒"
 *
 * 覆盖：
 * - 已装配唤醒执行器 ⇒ fire 真正调用它（携带 sessionId / kind / taskId）
 * - 未装配 ⇒ 不抛错、保持 fired（可观测降级，不静默）
 * - 未知 wakeId ⇒ 不抛错且不触发执行器
 * - 执行器返回失败 ⇒ 不抛错（由 fire 内部 warn 处理）
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// 覆盖数据目录，避免污染真实数据（与既有 SelfWake.test.ts 同法）
const testDataDir = join(tmpdir(), `cg3-selfwake-fire-${randomUUID()}.d`);
process.env.PYAPP_DATA_DIR = testDataDir;

const { WakeStore } = await import('../../../src/tasks/selfwake/WakeStore');
const { SelfWakeService } =
  await import('../../../src/tasks/selfwake/SelfWakeService');
const { setSelfWakeResumeHandler, hasSelfWakeResumeHandler } =
  await import('../../../src/tasks/selfwake/SelfWakeService');
const { setSelfWakeAuditSink, hasSelfWakeAuditSink } =
  await import('../../../src/tasks/selfwake/SelfWakeAudit');
const { WakeKind } = await import('../../../src/tasks/selfwake/types');

/** `session/wake` 载荷形状（测试断言用；与 eventPayloads.ts 同源） */
interface WakeEventData {
  wakeId: string;
  kind: string;
  taskId?: string;
  outcome: string;
  error?: string;
}

/** 长时间 tick 间隔 ⇒ sleepFor 走"长时"分支，不创建真实 setTimeout */
const LONG_TICK = 1000;

describe('SelfWakeService.fire —— 真正唤醒会话（N-26）', () => {
  beforeEach(() => {
    if (!existsSync(testDataDir)) mkdirSync(testDataDir, { recursive: true });
    setSelfWakeResumeHandler(null);
  });

  afterEach(() => {
    setSelfWakeResumeHandler(null);
    try {
      if (existsSync(testDataDir))
        rmSync(testDataDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it('已装配执行器 ⇒ fire 调用它并携带条目上下文', async () => {
    const service = new SelfWakeService(new WakeStore(), LONG_TICK);
    const sessionId = 'test-fire-session';
    const entry = await service.sleepFor(sessionId, 'task-1', 80_000);

    const calls: Array<{
      sessionId: string;
      wakeId: string;
      kind: string;
      taskId: string;
    }> = [];
    setSelfWakeResumeHandler(async (params) => {
      calls.push({
        sessionId: params.sessionId,
        wakeId: params.wakeId,
        kind: params.kind,
        taskId: params.taskId,
      });
      return { ok: true };
    });

    await service.fire(entry.id);

    expect(calls.length).toBe(1);
    expect(calls[0]?.sessionId).toBe(sessionId);
    expect(calls[0]?.wakeId).toBe(entry.id);
    expect(calls[0]?.kind).toBe(WakeKind.TIMER);
    expect(calls[0]?.taskId).toBe('task-1');
    service.destroy();
  });

  it('未装配执行器 ⇒ 不抛错且状态仍标记为 fired（可观测降级）', async () => {
    const service = new SelfWakeService(new WakeStore(), LONG_TICK);
    const sessionId = 'test-fire-absent';
    const entry = await service.sleepFor(sessionId, 'task-2', 80_000);

    expect(hasSelfWakeResumeHandler()).toBe(false);
    await service.fire(entry.id); // 不应抛错

    const reloaded = await new WakeStore().load(sessionId);
    expect(reloaded.find((e) => e.id === entry.id)?.status).toBe('fired');
    service.destroy();
  });

  it('未知 wakeId ⇒ 不抛错且不触发执行器', async () => {
    const service = new SelfWakeService(new WakeStore(), LONG_TICK);
    let called = false;
    setSelfWakeResumeHandler(async () => {
      called = true;
      return { ok: true };
    });

    await service.fire('non-existent-wake-id');

    expect(called).toBe(false);
    service.destroy();
  });

  it('执行器返回失败 ⇒ 不抛错（由 fire 内部记录告警）', async () => {
    const service = new SelfWakeService(new WakeStore(), LONG_TICK);
    const sessionId = 'test-fire-fail';
    const entry = await service.sleepFor(sessionId, 'task-3', 80_000);

    setSelfWakeResumeHandler(async () => ({ ok: false, error: 'boom' }));

    await service.fire(entry.id); // 不应抛错
    service.destroy();
  });
});

/**
 * T-⑥12（2026-10-03）：自唤醒续跑审计事件 `session/wake`。
 *
 * 唤醒→续跑是系统自动发起；修复前各可判定节点只有 logger 文本，无法从持久层重建。
 * 本组用例锁定「各节点均落一条结构化事件」，并覆盖「未装配 sink ⇒ 如实不落且不抛错」。
 */
describe('SelfWakeService.fire —— session/wake 审计（T-⑥12）', () => {
  beforeEach(() => {
    if (!existsSync(testDataDir)) mkdirSync(testDataDir, { recursive: true });
    setSelfWakeResumeHandler(null);
    setSelfWakeAuditSink(null);
  });

  afterEach(() => {
    setSelfWakeResumeHandler(null);
    setSelfWakeAuditSink(null);
    try {
      if (existsSync(testDataDir))
        rmSync(testDataDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  /** 装配 sink 收集器 + 可选执行器，fire 一次后返回收到的审计事件 */
  async function fireAndCollect(opts: {
    sessionId: string;
    taskId: string;
    handler: (() => Promise<{ ok: boolean; error?: string }>) | null;
  }): Promise<{
    wakeId: string;
    events: Array<{ sessionId: string; event: unknown }>;
  }> {
    const service = new SelfWakeService(new WakeStore(), LONG_TICK);
    const entry = await service.sleepFor(opts.sessionId, opts.taskId, 80_000);

    const events: Array<{ sessionId: string; event: unknown }> = [];
    setSelfWakeAuditSink(async (sid, ev) => {
      events.push({ sessionId: sid, event: ev });
      return { ok: true, tailSeq: events.length };
    });
    if (opts.handler) setSelfWakeResumeHandler(opts.handler);

    await service.fire(entry.id);
    service.destroy();
    return { wakeId: entry.id, events };
  }

  const dataOf = (events: Array<{ event: unknown }>): WakeEventData =>
    (events[0]!.event as { data: WakeEventData }).data;

  it('续跑成功 ⇒ 落一条 session/wake（resumed，含 wakeId/kind/taskId，seq=0 待原子分配）', async () => {
    const { wakeId, events } = await fireAndCollect({
      sessionId: 'audit-resumed',
      taskId: 'task-a',
      handler: async () => ({ ok: true }),
    });

    expect(events.length).toBe(1);
    expect(events[0]!.sessionId).toBe('audit-resumed');
    const envelope = events[0]!.event as {
      type: string;
      seq: number;
      sessionId: string;
    };
    expect(envelope.type).toBe('session/wake');
    expect(envelope.seq).toBe(0);
    expect(envelope.sessionId).toBe('audit-resumed');

    const data = dataOf(events);
    expect(data.wakeId).toBe(wakeId);
    expect(data.kind).toBe(WakeKind.TIMER);
    expect(data.taskId).toBe('task-a');
    expect(data.outcome).toBe('resumed');
    expect(data.error).toBeUndefined();
  });

  it('续跑返回失败 ⇒ outcome=resume_failed 且 error 落盘', async () => {
    const { events } = await fireAndCollect({
      sessionId: 'audit-failed',
      taskId: 'task-b',
      handler: async () => ({ ok: false, error: 'boom' }),
    });

    expect(events.length).toBe(1);
    const data = dataOf(events);
    expect(data.outcome).toBe('resume_failed');
    expect(data.error).toBe('boom');
  });

  it('执行器抛错 ⇒ 同样记 resume_failed（error=异常文本）', async () => {
    const { events } = await fireAndCollect({
      sessionId: 'audit-threw',
      taskId: 'task-c',
      handler: async () => {
        throw new Error('resume exploded');
      },
    });

    expect(events.length).toBe(1);
    const data = dataOf(events);
    expect(data.outcome).toBe('resume_failed');
    expect(data.error).toContain('resume exploded');
  });

  it('未装配执行器 ⇒ outcome=handler_absent（"发出但无人接"留痕）', async () => {
    const { events } = await fireAndCollect({
      sessionId: 'audit-absent',
      taskId: 'task-d',
      handler: null,
    });

    expect(events.length).toBe(1);
    const data = dataOf(events);
    expect(data.outcome).toBe('handler_absent');
    expect(data.taskId).toBe('task-d');
  });

  it('未装配审计 sink ⇒ 如实不落事件且不抛错（可观测降级）', async () => {
    const service = new SelfWakeService(new WakeStore(), LONG_TICK);
    const entry = await service.sleepFor('audit-no-sink', 'task-e', 80_000);
    setSelfWakeResumeHandler(async () => ({ ok: true }));

    expect(hasSelfWakeAuditSink()).toBe(false);
    await service.fire(entry.id); // 不应抛错
    service.destroy();
  });
});
