// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// P2-C 回归测试（2026-09-17）：
//   onStepProgress 内 catch 原为空（失败静默）——补 logger.warn('PDCA 进度回写失败')
//   使进度回写故障可观测。本测试：persistMessage 抛错 → 断言 warn 被调用。
//
// 注入说明：不 mock 模块——bun 在 Windows 上测试文件共享进程，mock.module 会劫持
// 同进程内 planDrivenLoop.test.ts（真实逻辑测试）。改用 deps.planLoopFactory 注入
// FakePlanDrivenLoop（PdcaLauncher 默认仍 new 真实 PlanDrivenLoop，行为零变化）。

import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PdcaLauncherDeps } from '../../src/chat/launchers/PdcaLauncher.js';
import type { PlanDrivenLoop } from '../../src/tasks/PlanDrivenLoop.js';
import { PdcaLauncher } from '../../src/chat/launchers/PdcaLauncher.js';
import { getLogger } from '@modules/monitoring';

// Fake PlanDrivenLoop：构造时捕获 config（onStepProgress 在 launch 后手动触发），
// run 直接返回完成结果（不真正跑编排）
class FakePlanDrivenLoop {
  static lastConfig: Record<string, unknown> | null = null;
  constructor(config: Record<string, unknown>) {
    FakePlanDrivenLoop.lastConfig = config;
  }
  async run(): Promise<Record<string, unknown>> {
    return {
      aborted: false,
      budgetExhausted: false,
      stepCount: 1,
      completedSteps: 1,
      failedSteps: 0,
      decomposed: false,
      totalDurationMs: 0,
    };
  }
}

describe('P2-C: PDCA 进度回写失败补 warn 日志', () => {
  let dataDir: string;
  let warnSpy: ReturnType<typeof mock>;
  // getLogger 按 module 名返回共享单例——与 PdcaLauncher 模块内 logger 同实例
  const logger = getLogger('chat:pdcaLauncher') as unknown as {
    warn: (...args: unknown[]) => unknown;
  };

  beforeAll(() => {
    // writePdcaCheckpoint 写 ~/.pyapp/data/pdca/ —— 隔离到临时目录，防污染真实数据
    dataDir = mkdtempSync(join(tmpdir(), 'pdca-launcher-'));
    process.env.LIRI_DATA_DIR = dataDir;
    warnSpy = mock((_msg: unknown, _data?: unknown) => {});
    logger.warn = warnSpy;
  });

  afterAll(async () => {
    logger.warn = (() => {}) as unknown as (...args: unknown[]) => unknown;
    // GAI-3：checkpoint 迁入 app.db ⇒ 先关闭 DB 连接（WAL 句柄），再清理临时目录
    const { closePdcaCheckpointStore } =
      await import('../../src/tasks/PdcaWorkItemBridge.js');
    closePdcaCheckpointStore();
    delete process.env.LIRI_DATA_DIR;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('onStepProgress 回写失败时 logger.warn 留痕', async () => {
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
      persistMessage: () => {
        throw new Error('simulated persist failure');
      },
      planLoopFactory: (config: Record<string, unknown>) =>
        new FakePlanDrivenLoop(config) as unknown as PlanDrivenLoop,
    } as unknown as PdcaLauncherDeps;

    const launcher = new PdcaLauncher(deps);
    // 快速路径（useFastPath=true）→ PlanDrivenLoop 分支
    await launcher.launch('proj1', 'desc', 'sess1', undefined, true);

    const config = FakePlanDrivenLoop.lastConfig as {
      onStepProgress?: (p: {
        completed: number;
        total: number;
        percent: number;
      }) => void;
    };
    expect(config?.onStepProgress).toBeDefined();
    config!.onStepProgress!({ completed: 1, total: 2, percent: 50 });

    expect(warnSpy).toHaveBeenCalled();
    const calls = (warnSpy as unknown as { mock: { calls: unknown[][] } }).mock
      .calls;
    expect(calls.some((c) => c[0] === 'PDCA 进度回写失败')).toBe(true);
  });
});

// ── 13-P1-1 Step 2（2026-10-06，`任务计划-20261004.md` §20.6）：阻断结果回灌 ──
// 取证（F8）：被阻断步骤原先只落 plan 步 `cancelled` + SSE（用户可见），**模型侧完全不可见**。
// 本批要求：`run()` 返回 `blockedSteps` 时，PdcaLauncher 落一条**模型可见**的助手消息
// （复用既有 `pdca-progress` 通道 ⇒ 落盘后进入后续轮次上下文）。
class FakeBlockedPlanDrivenLoop {
  static result: Record<string, unknown> = {};
  constructor(_config: Record<string, unknown>) {}
  async run(): Promise<Record<string, unknown>> {
    return FakeBlockedPlanDrivenLoop.result;
  }
}

describe('13-P1-1 Step 2: 依赖阻断结果回灌会话（模型可见）', () => {
  let dataDir: string;

  beforeAll(() => {
    // writePdcaCheckpoint 写 ~/.pyapp/data/pdca/ —— 隔离到独立临时目录
    dataDir = mkdtempSync(join(tmpdir(), 'pdca-launcher-blocked-'));
    process.env.LIRI_DATA_DIR = dataDir;
  });

  afterAll(async () => {
    const { closePdcaCheckpointStore } =
      await import('../../src/tasks/PdcaWorkItemBridge.js');
    closePdcaCheckpointStore();
    delete process.env.LIRI_DATA_DIR;
    rmSync(dataDir, { recursive: true, force: true });
  });

  type PersistedMsg = {
    content: string;
    metadata?: Record<string, unknown>;
  };

  function makeDeps(persisted: PersistedMsg[]): PdcaLauncherDeps {
    return {
      enablePlanDrivenLoop: true,
      taorLoopFactory: () => ({}) as never,
      buildTAORContext: () => ({}),
      sessionMap: new Map(),
      messageService: {
        createAssistantMessage: (
          content: string,
          opts?: { metadata?: Record<string, unknown> }
        ) => ({ content, metadata: opts?.metadata }),
      },
      persistMessage: (_sessionId: string, msg: PersistedMsg) => {
        persisted.push(msg);
      },
      planLoopFactory: (config: Record<string, unknown>) =>
        new FakeBlockedPlanDrivenLoop(config) as unknown as PlanDrivenLoop,
    } as unknown as PdcaLauncherDeps;
  }

  it('blockedSteps 非空 ⇒ 落一条含阻断原因的助手消息（taskType=pdca-progress）', async () => {
    FakeBlockedPlanDrivenLoop.result = {
      aborted: false,
      budgetExhausted: false,
      decomposed: true,
      stepCount: 2,
      completedSteps: 1,
      failedSteps: 1,
      skippedSteps: 1,
      blockedSteps: [
        { stepId: 'step-3', description: '步骤C', reason: '前驱 a 执行失败' },
      ],
      totalDurationMs: 1,
    };
    const persisted: PersistedMsg[] = [];
    const launcher = new PdcaLauncher(makeDeps(persisted));

    await launcher.launch('proj1', 'desc', 'sess1', undefined, true);

    const blockedMsg = persisted.find((m) => m.content.includes('依赖阻断'));
    expect(blockedMsg).toBeDefined();
    expect(blockedMsg?.content).toContain('步骤C');
    expect(blockedMsg?.content).toContain('前驱 a 执行失败');
    // 复用既有进度通道 ⇒ 前端渲染与模型可见性都不依赖新类型
    expect(blockedMsg?.metadata?.taskType).toBe('pdca-progress');
    expect(blockedMsg?.metadata?.isTaskMessage).toBe(true);
  });

  it('blockedSteps 为空 ⇒ 不额外落阻断消息（零回归）', async () => {
    FakeBlockedPlanDrivenLoop.result = {
      aborted: false,
      budgetExhausted: false,
      decomposed: true,
      stepCount: 1,
      completedSteps: 1,
      failedSteps: 0,
      skippedSteps: 0,
      blockedSteps: [],
      totalDurationMs: 1,
    };
    const persisted: PersistedMsg[] = [];
    const launcher = new PdcaLauncher(makeDeps(persisted));

    await launcher.launch('proj1', 'desc', 'sess2', undefined, true);

    expect(persisted.some((m) => m.content.includes('依赖阻断'))).toBe(false);
  });
});
