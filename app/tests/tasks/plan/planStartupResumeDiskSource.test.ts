// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 2026-11-19：`planStartupResume` 的**真实磁盘计划源**回归（补「running + 杀进程」验证缺口）。
 *
 * 现有用例（`planStartupResume.test.ts`）一律注入 `fakeSource`，因此
 * `loadDefaultPlanSource → taskOrchestrator.initialize() → 读 <data>/plans/plan_*.json` 这条
 * **真实接线**从未被测过。本用例只做一件事：把一份"进程被杀时留下的现场"写到磁盘上
 * （`running` + 有未终态步骤 + 心跳过期 20min），断言启动扫描能选中它并登记一次唤醒。
 *
 * 与真机的差别：不真的杀进程，只复刻它留在磁盘上的状态（同 `TaskOrchestrator` 的 ghost 判定口径）。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'plan-resume-disk-'));
/**
 * ⚠️ 只改开关，**不改** `LIRI_DATA_DIR` / `LIRI_HOME`：bun test 同进程跑多文件，
 * 偷改全局数据目录会污染其它用例（CI #2142 实测：本文件曾设 `LIRI_DATA_DIR` 后
 * `balanceRecurringWarn` 的「绝不写到真实 ~/.pyapp」负向自证变红）。
 * 计划目录已在用例内用 `setPlansDir()` 显式指定，无需动环境。
 */
const envKey = 'FEATURE_PLAN_STARTUP_RESUME';
const envBefore = process.env[envKey];
process.env[envKey] = 'true';

/** 心跳：20 分钟前（> 10min 过期阈值，且 < 24h 新鲜窗口） */
const HEARTBEAT_MS = Date.now() - 20 * 60_000;

afterAll(() => {
  if (envBefore === undefined) delete process.env[envKey];
  else process.env[envKey] = envBefore;
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // @ignore-catch — Windows 下编排器/DB 仍持有句柄（EBUSY）；临时目录留给 OS 清理，不影响用例结论
  }
});

describe('enqueueStartupPlanResumes：真实磁盘计划源（重启续跑）', () => {
  it('磁盘上 running + 心跳过期 + 有未终态步骤 ⇒ 选中并登记一次唤醒', async () => {
    const plansDir = join(dataDir, 'plans');
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(
      join(plansDir, 'plan_disk.json'),
      JSON.stringify({
        id: 'plan_disk',
        description: '重启续跑验证',
        sessionId: 'sess-disk-1',
        status: 'running',
        createdAt: new Date(HEARTBEAT_MS - 3_600_000).toISOString(),
        lastHeartbeatAt: new Date(HEARTBEAT_MS).toISOString(),
        steps: [
          { id: 's1', description: '已完成的第一步', status: 'completed' },
          { id: 's2', description: '被中断的一步', status: 'running' },
        ],
      }),
      'utf8'
    );

    // 新建独立实例（不依赖进程级单例：同目录其它用例可能已初始化过它）
    const { TaskOrchestrator } =
      await import('../../../src/tasks/TaskOrchestrator');
    const orchestrator = new TaskOrchestrator();
    orchestrator.setPlansDir(plansDir);
    await orchestrator.initialize();
    // 前置断言：磁盘上的计划确实被真实加载（否则后面"选中"就没有意义）
    expect(orchestrator.getAllPlans().map((p) => p.id)).toContain('plan_disk');

    const {
      PLAN_STARTUP_RESUME_TASK_PREFIX,
      buildPlanResumeTaskId,
      enqueueStartupPlanResumes,
    } = await import('../../../src/tasks/plan/planStartupResume');

    const calls: Array<{ sessionId: string; taskId: string; seconds: number }> =
      [];
    const scheduler = {
      sleepFor: async (sessionId: string, taskId: string, seconds: number) => {
        calls.push({ sessionId, taskId, seconds });
      },
      getPendingBySession: async () => [],
    };

    const report = await enqueueStartupPlanResumes({
      scheduler,
      source: orchestrator,
      now: Date.now(),
    });

    // 事实源真的读到了磁盘上的计划（而非空源）
    expect(report.scanned).toBeGreaterThanOrEqual(1);
    expect(report.enqueued).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sessionId).toBe('sess-disk-1');
    expect(
      calls[0]?.taskId.startsWith(
        `${PLAN_STARTUP_RESUME_TASK_PREFIX}plan_disk:`
      )
    ).toBe(true);
    // taskId 编码的心跳 = 磁盘上的心跳（供触发期"心跳未变"二次校验）
    expect(calls[0]?.taskId).toBe(
      buildPlanResumeTaskId('plan_disk', HEARTBEAT_MS)
    );
  });
});
