// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 特征化测试：`PdcaLauncher.launch()` 的 **PDL 进度回写**（P3-2 外移前置，2026-11-17）
 *
 * 目的：在把 `onStepProgress` 回调整段外移为私有方法**之前**，用测试钉住当前行为：
 * 档位节流（25%/50%/75%/完成，跳过 0%）、`total<=0` 跳过、产物门下的文案与 ✅ 前缀。
 * 外移后本文件必须**逐字不变、全绿**。
 *
 * 注入方式与 `PdcaLauncher-progress.test.ts` 同款（`deps.planLoopFactory` 注入 FakeLoop，
 * 不 mock 模块 —— 避免劫持同进程内其它 PDCA 测试）。
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PdcaLauncherDeps } from '../../src/chat/launchers/PdcaLauncher.js';
import type { PlanDrivenLoop } from '../../src/tasks/PlanDrivenLoop.js';
import { PdcaLauncher } from '../../src/chat/launchers/PdcaLauncher.js';

type StepProgress = {
  completed: number;
  total: number;
  percent: number;
  failed: number;
  cancelled: number;
  artifactGated?: boolean;
};

type PersistedMsg = { content: string; metadata?: Record<string, unknown> };

class FakePlanDrivenLoop {
  static lastConfig: Record<string, unknown> | null = null;
  constructor(config: Record<string, unknown>) {
    FakePlanDrivenLoop.lastConfig = config;
  }
  async run(): Promise<Record<string, unknown>> {
    return {
      aborted: false,
      budgetExhausted: false,
      stepCount: 4,
      completedSteps: 4,
      failedSteps: 0,
      decomposed: false,
      totalDurationMs: 0,
    };
  }
}

describe('PdcaLauncher.launch · PDL 进度回写（特征化）', () => {
  let dataDir: string;
  let persisted: PersistedMsg[] = [];

  beforeAll(() => {
    // writePdcaCheckpoint 写 LIRI_DATA_DIR —— 隔离到临时目录，防污染真实数据
    dataDir = mkdtempSync(join(tmpdir(), 'pdca-launcher-progress-'));
    process.env.LIRI_DATA_DIR = dataDir;
  });

  afterAll(async () => {
    const { closePdcaCheckpointStore } =
      await import('../../src/tasks/PdcaWorkItemBridge.js');
    closePdcaCheckpointStore();
    delete process.env.LIRI_DATA_DIR;
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function launchAndCapture(): Promise<(p: StepProgress) => void> {
    persisted = [];
    const deps = {
      enablePlanDrivenLoop: true,
      taorLoopFactory: () => ({}) as never,
      buildTAORContext: () => ({}),
      sessionMap: new Map(),
      messageService: {
        createAssistantMessage: (content: string, opts?: unknown) => ({
          content,
          ...(opts as object),
        }),
      },
      persistMessage: (_sessionId: string, msg: PersistedMsg) => {
        persisted.push(msg);
      },
      planLoopFactory: (config: Record<string, unknown>) =>
        new FakePlanDrivenLoop(config) as unknown as PlanDrivenLoop,
    } as unknown as PdcaLauncherDeps;

    await new PdcaLauncher(deps).launch(
      'proj1',
      'desc',
      'sess1',
      undefined,
      true
    );
    // 只保留进度回调产生的消息（launch 自身会写模式提示等消息，与本组判据无关）
    persisted = [];
    const config = FakePlanDrivenLoop.lastConfig as {
      onStepProgress?: (p: StepProgress) => void;
    };
    expect(config?.onStepProgress).toBeDefined();
    return config.onStepProgress!;
  }

  it('0% 与 total<=0 不产消息；50% 产一条并节流；100%（无产物门）产完成文案', async () => {
    const onStepProgress = await launchAndCapture();

    // 0%：跳过首条
    onStepProgress({
      completed: 0,
      total: 4,
      percent: 0,
      failed: 0,
      cancelled: 0,
    });
    expect(persisted).toHaveLength(0);

    // total<=0：跳过
    onStepProgress({
      completed: 0,
      total: 0,
      percent: 0,
      failed: 0,
      cancelled: 0,
    });
    expect(persisted).toHaveLength(0);

    // 50% ⇒ bucket 2 ⇒ 一条「未完全达成」提示
    onStepProgress({
      completed: 2,
      total: 4,
      percent: 50,
      failed: 0,
      cancelled: 0,
    });
    expect(persisted).toHaveLength(1);
    expect(persisted[0].content).toContain('PDCA 未完全达成');
    expect(persisted[0].content).toContain('2/4');
    expect(persisted[0].metadata?.taskType).toBe('pdca-progress');

    // 同档位重复回调 ⇒ 节流，不新增
    onStepProgress({
      completed: 2,
      total: 4,
      percent: 55,
      failed: 0,
      cancelled: 0,
    });
    expect(persisted).toHaveLength(1);

    // 100% 且全部完成、无产物门 ⇒ 完成文案（带 ✅ 前缀）
    onStepProgress({
      completed: 4,
      total: 4,
      percent: 100,
      failed: 0,
      cancelled: 0,
    });
    expect(persisted).toHaveLength(2);
    expect(persisted[1].content).toContain('✅');
    expect(persisted[1].content).toContain('PDCA 执行完成：4/4 步');
  });

  it('100% 但产物门压住 ⇒ 仍报「未完全达成」并说明进度不计', async () => {
    const onStepProgress = await launchAndCapture();

    onStepProgress({
      completed: 4,
      total: 4,
      percent: 100,
      failed: 0,
      cancelled: 0,
      artifactGated: true,
    });

    expect(persisted).toHaveLength(1);
    expect(persisted[0].content).toContain('PDCA 未完全达成');
    expect(persisted[0].content).toContain('本任务尚未产出任何产物');
    expect(persisted[0].content).not.toContain('✅');
  });

  it('未达成 / 未执行步数如实出现在文案里', async () => {
    const onStepProgress = await launchAndCapture();

    onStepProgress({
      completed: 2,
      total: 4,
      percent: 50,
      failed: 1,
      cancelled: 1,
    });

    expect(persisted).toHaveLength(1);
    expect(persisted[0].content).toContain('1 步未达成');
    expect(persisted[0].content).toContain('1 步未执行');
  });
});
