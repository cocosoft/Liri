// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `/goal start` 的启动期失败收口（2026-11-08 真机 `pdca_mw7gf70g`，D55 的 CLI 路径）。
 *
 * 缺陷：`runFullPdca` 在规划阶段抛 `PLAN_PARSE_FAILED` 时，`Goal.ts` 的 catch 只记日志
 * ⇒ 检查点停在 `status=started / phase=plan`；而 `/goal start` 的幂等判据是
 * `!PDCA_TERMINAL_PHASES.has(ck.phase)` ⇒ 该会话**再也起不了新任务**（只会回"已有进行中"）。
 *
 * 本用例以 `runFullPdca` 原型打桩模拟确定性失败，验证：
 *   ① 检查点被收口为 `failed`（`replanPending=false`）；
 *   ② 同会话再次 `/goal start` 能拿到**新 taskId**（幂等键已释放）。
 */
import { afterAll, afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'goal-start-fail-'));
process.env.LIRI_DATA_DIR = dataDir;

const { LongRunningTaskOrchestrator } =
  await import('../../src/tasks/LongRunningTaskOrchestrator');
const { readPdcaCheckpoint, closePdcaCheckpointStore } =
  await import('../../src/tasks/PdcaWorkItemBridge');
const { default: goalCommand } =
  await import('../../src/commands/builtin/goal/Goal');

const originalRunFullPdca = LongRunningTaskOrchestrator.prototype.runFullPdca;

afterEach(() => {
  LongRunningTaskOrchestrator.prototype.runFullPdca = originalRunFullPdca;
});

afterAll(async () => {
  closePdcaCheckpointStore();
  delete process.env.LIRI_DATA_DIR;
  try {
    rmSync(dataDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch {
    /* 临时目录清理失败不影响测试结论 */
  }
});

function stubPlannerFailure(): void {
  LongRunningTaskOrchestrator.prototype.runFullPdca = async function () {
    throw new Error('Planner 输出无法解析为有效计划（已重问一次）');
  } as never;
}

async function waitForFailedCheckpoint(
  sessionId: string,
  timeoutMs = 3000
): Promise<Record<string, unknown>> {
  const { listPdcaCheckpoints } =
    await import('../../src/tasks/PdcaWorkItemBridge');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const all = await listPdcaCheckpoints();
    const mine = all.find((ck) => ck.sessionId === sessionId);
    if (mine) {
      const ck = await readPdcaCheckpoint(String(mine.taskId));
      if (ck?.['phase'] === 'failed') return ck;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`等待 ${sessionId} 的 failed 检查点超时`);
}

describe('/goal start 启动期失败收口（D55）', () => {
  it('规划失败 ⇒ 检查点落 failed，且同会话可再起新任务（幂等键已释放）', async () => {
    const sessionId = `sess-goal-start-${Date.now()}`;
    stubPlannerFailure();

    const first = await goalCommand.handleStart(['写一个文件'], {
      sessionId,
      onDone: () => undefined,
    } as never);
    expect(first.success).toBe(true);
    const firstTaskId = (first.data as { taskId: string }).taskId;

    const ck = await waitForFailedCheckpoint(sessionId);
    expect(ck['status']).toBe('failed');
    expect(ck['replanPending']).toBe(false);

    const second = await goalCommand.handleStart(['再写一个文件'], {
      sessionId,
      onDone: () => undefined,
    } as never);
    expect(second.success).toBe(true);
    const secondTaskId = (second.data as { taskId: string }).taskId;
    expect(secondTaskId).not.toBe(firstTaskId);
  });
});
