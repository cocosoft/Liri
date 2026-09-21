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
const { WakeKind } = await import('../../../src/tasks/selfwake/types');

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
