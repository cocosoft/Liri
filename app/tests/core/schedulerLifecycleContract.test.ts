// MIT License
// Copyright (c) 2026 190615273@qq.com
import { describe, it, expect } from 'bun:test';
import { DiscoveryScheduler } from '../../src/tasks/alwayson/DiscoveryScheduler';
import { KnowledgeCompileScheduler } from '../../src/knowledge/KnowledgeCompileScheduler';
import type { SchedulerLifecycle } from '../../src/types/schedulerLifecycle';
import type { DreamScheduler } from '../../src/dream/DreamScheduler';
import type { CronScheduler } from '../../src/tasks/cron/CronScheduler';
import type { CompileResult } from '../../src/knowledge/KnowledgeCompiler';

/**
 * A4 残留项 T1-2 —— `SchedulerLifecycle` 窄契约用例（spec `orchestration-lifecycle-contract.md`）。
 *
 * 覆盖策略（如实）：
 * - **编译期**：4 个定时调度器均须满足窄契约 —— 任一类移除 `implements` 或改签名 ⇒ `bun run typecheck` 失败；
 * - **运行期**：对**无重依赖**的两个（`DiscoveryScheduler` / `KnowledgeCompileScheduler`）验证
 *   `start → isRunning=true → stop → false` 与**幂等**；`DreamScheduler` / `CronScheduler` 构造需
 *   store / 持久化依赖，此处仅做编译期守卫（其行为用例见 `tests/chronos/cron.test.ts` 等）。
 */
function assertSchedulerLifecycle<T extends SchedulerLifecycle>(): void {}
assertSchedulerLifecycle<DiscoveryScheduler>();
assertSchedulerLifecycle<DreamScheduler>();
assertSchedulerLifecycle<CronScheduler>();
assertSchedulerLifecycle<KnowledgeCompileScheduler>();

const emptyCompile = async (): Promise<CompileResult> => ({
  compiled: 0,
  skipped: 0,
  errors: [],
  totalFound: 0,
  pagesCreated: 0,
  compiledFiles: [],
  compiledRaws: [],
});

describe('SchedulerLifecycle 契约（T1-2）', () => {
  it('DiscoveryScheduler：start/stop 状态转移 + 幂等', async () => {
    const scheduler = new DiscoveryScheduler(0.001, async () => {});

    expect(scheduler.isRunning()).toBe(false);
    await scheduler.start();
    expect(scheduler.isRunning()).toBe(true);

    await scheduler.start(); // 幂等：重复启动不改变状态
    expect(scheduler.isRunning()).toBe(true);

    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);

    scheduler.stop(); // 幂等：重复停止不抛错
    expect(scheduler.isRunning()).toBe(false);
  });

  it('KnowledgeCompileScheduler：isRunning 与 intervalTimer 同步（T1-1 新增方法）', () => {
    const scheduler = new KnowledgeCompileScheduler(emptyCompile, {
      intervalMs: 60_000,
      delayMs: 1_000,
      runOnStart: false,
    });

    expect(scheduler.isRunning()).toBe(false);
    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);

    scheduler.start(); // 幂等：start() 内以同一判据（intervalTimer）短路
    expect(scheduler.isRunning()).toBe(true);

    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
  });
});
