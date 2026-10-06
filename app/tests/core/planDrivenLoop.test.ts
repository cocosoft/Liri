// MIT License
// Copyright (c) 2026 190615273@qq.com

// S0 行为冻结（2026-08-13）：复杂度判定结构化（CS02）+ 子任务上限唯一来源
// S3（2026-08-13）：快速路径准入（isEligibleForFastPath：复杂度门 + 危险工具过滤）
import { describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildPredecessorSummary,
  classifyTaskComplexity,
  hasDangerousToolIntent,
  isEligibleForFastPath,
  PlanDrivenLoop,
  type DependencyProbe,
  type TAORLoopFactoryOptions,
} from '../../src/tasks/PlanDrivenLoop';
// T-②05（2026-10-03）：默认阈值事实源已下沉 core（原 `SIMPLE_TASK_MAX_LENGTH` 为本地硬编码常量）
import { DEFAULT_FAST_PATH_MAX_LENGTH } from '../../src/types/fastPath';
import { MAX_SUBTASKS } from '../../src/ai/router/TaskDecomposer';
import type { TAORLoop } from '../../src/query/TAORLoop';
import type { TAORLoopDeps } from '../../src/query/TAORLoop';
// 13-P2-2（2026-10-05）：行为反馈回流
import { TaskOutcomeLedger } from '../../src/tasks/behaviorFeedback';
// 13-P1-1 Step 2：分解路径（PDL 阻断行为）+ 计划持久化隔离
import { taskOrchestrator } from '../../src/tasks/TaskOrchestrator';
import type { AIProvider } from '../../src/ai/providers/AIProvider';

describe('classifyTaskComplexity — 结构化判定（无正则）', () => {
  it('空/空白消息判定为 complex（不误入快速路径）', () => {
    expect(classifyTaskComplexity('')).toBe('complex');
    expect(classifyTaskComplexity('   ')).toBe('complex');
  });

  it('短问候/致谢/短问题（≤60）判定为 simple', () => {
    expect(classifyTaskComplexity('你好')).toBe('simple');
    expect(classifyTaskComplexity('谢谢')).toBe('simple');
    expect(classifyTaskComplexity('什么是 React')).toBe('simple');
    expect(classifyTaskComplexity('翻译这段话：Hello world')).toBe('simple');
  });

  it('恰好等于阈值的消息判定为 simple', () => {
    const msg = '你'.repeat(DEFAULT_FAST_PATH_MAX_LENGTH);
    expect(msg.length).toBe(DEFAULT_FAST_PATH_MAX_LENGTH);
    expect(classifyTaskComplexity(msg)).toBe('simple');
  });

  it('超过阈值的长任务判定为 complex', () => {
    const msg = '请'.repeat(DEFAULT_FAST_PATH_MAX_LENGTH + 1);
    expect(classifyTaskComplexity(msg)).toBe('complex');
  });

  it('trim 后按有效长度判定（首尾空白不计入）', () => {
    const inner = '你'.repeat(DEFAULT_FAST_PATH_MAX_LENGTH);
    expect(classifyTaskComplexity(`  ${inner}  `)).toBe('simple');
  });

  it('T-②05：显式传入阈值即生效（配置驱动的前提）', () => {
    const msg = '请'.repeat(DEFAULT_FAST_PATH_MAX_LENGTH + 1);
    expect(classifyTaskComplexity(msg, DEFAULT_FAST_PATH_MAX_LENGTH + 1)).toBe(
      'simple'
    );
    expect(classifyTaskComplexity('你好', 1)).toBe('complex');
  });
});

describe('子任务上限唯一来源（S0 冻结）', () => {
  it('MAX_SUBTASKS 为 5（TaskDecomposer 唯一事实来源）', () => {
    expect(MAX_SUBTASKS).toBe(5);
  });
});

describe('hasDangerousToolIntent — 危险工具意图过滤（S3）', () => {
  it('识别删除/移除类意图', () => {
    expect(hasDangerousToolIntent('请删除这个文件')).toBe(true);
    expect(hasDangerousToolIntent('移除整个目录')).toBe(true);
    expect(hasDangerousToolIntent('delete test.txt')).toBe(true);
  });

  it('识别发送/写入/覆盖类意图', () => {
    expect(hasDangerousToolIntent('发送邮件给张三')).toBe(true);
    expect(hasDangerousToolIntent('写入配置并覆盖')).toBe(true);
    expect(hasDangerousToolIntent('overwrite the file')).toBe(true);
  });

  it('普通消息不误判', () => {
    expect(hasDangerousToolIntent('帮我整理这个项目')).toBe(false);
    expect(hasDangerousToolIntent('什么是 React')).toBe(false);
  });
});

describe('isEligibleForFastPath — S3 两层分流第一层', () => {
  it('简单任务且无危险工具 → 合格', () => {
    expect(isEligibleForFastPath('你好')).toBe(true);
    expect(isEligibleForFastPath('解释一下什么是依赖注入')).toBe(true);
  });

  it('含危险工具即使简单也不合格（后果不可逆，走经典路径质量门）', () => {
    expect(isEligibleForFastPath('删除这个文件')).toBe(false);
    expect(isEligibleForFastPath('发送消息')).toBe(false);
  });

  it('复杂任务不合格（复杂度门筛除）', () => {
    const longMsg = '请'.repeat(DEFAULT_FAST_PATH_MAX_LENGTH + 1);
    expect(isEligibleForFastPath(longMsg)).toBe(false);
  });

  it('T-②05：显式传入判据即生效（配置驱动的前提）', () => {
    const longMsg = '请'.repeat(DEFAULT_FAST_PATH_MAX_LENGTH + 1);
    expect(
      isEligibleForFastPath(longMsg, {
        maxSimpleTaskLength: longMsg.length,
        dangerousIntentPatterns: [],
      })
    ).toBe(true);
    expect(
      isEligibleForFastPath('你好', {
        maxSimpleTaskLength: 60,
        dangerousIntentPatterns: [/你好/],
      })
    ).toBe(false);
  });
});

describe('D1: taorLoopFactory 二元签名契约（PDL 侧）', () => {
  it('二元工厂 (sessionId, opts?) 可注入且被原样保存（与 LRTO/PdcaLauncher 同一契约）', () => {
    // D1（2026-09-17）：PDL 原一元声明导致调用方二元工厂的 opts 类型不被识别，
    // PDL 内部只传 sessionId 时 opts 静默丢失。放宽签名后，二元工厂须可注入且不丢失。
    const fakeLoop = {} as TAORLoop;
    const factory = (
      _sessionId: string,
      _opts?: TAORLoopFactoryOptions
    ): TAORLoop => fakeLoop;

    const pdl = new PlanDrivenLoop({
      taorLoop: fakeLoop,
      deps: {} as TAORLoopDeps,
      sessionId: 's1',
      taorLoopFactory: factory,
    });

    const stored = (
      pdl as unknown as {
        taorLoopFactory?: (
          sessionId: string,
          opts?: TAORLoopFactoryOptions
        ) => TAORLoop;
      }
    ).taorLoopFactory;
    expect(stored).toBe(factory);
  });
});

describe('T-②05: 快速路径判据可注入（测试确定性 / 生产读配置）', () => {
  it('注入 fastPathPolicy 即生效；未注入则回退默认判据（60）', () => {
    const fakeLoop = {} as TAORLoop;
    const injected = {
      maxSimpleTaskLength: 5,
      dangerousIntentPatterns: [],
    };
    const pdl = new PlanDrivenLoop({
      taorLoop: fakeLoop,
      deps: {} as TAORLoopDeps,
      sessionId: 's1',
      fastPathPolicy: injected,
    });
    const stored = (
      pdl as unknown as {
        fastPathPolicy: { maxSimpleTaskLength: number };
      }
    ).fastPathPolicy;
    expect(stored).toBe(injected);
    expect(stored.maxSimpleTaskLength).toBe(5);
  });
});

describe('13-P2-2: 行为反馈回流接入路径选择（最小回流点）', () => {
  const POLICY = { maxSimpleTaskLength: 60, dangerousIntentPatterns: [] };
  const makeLoop = () =>
    ({
      reset: () => {},
      runCollect: async () => ({ totalTokens: 1, turnCount: 1 }),
    }) as unknown as TAORLoop;

  it('无历史样本 ⇒ 简单任务仍走快速路径（结果记入 simple 桶）', async () => {
    const ledger = new TaskOutcomeLedger();
    const pdl = new PlanDrivenLoop({
      taorLoop: makeLoop(),
      deps: {} as TAORLoopDeps,
      sessionId: 's1',
      fastPathPolicy: POLICY,
      outcomeLedger: ledger,
      outcomeKey: 'k',
    });
    await pdl.run('你好');
    expect(ledger.signal('k::simple')?.sampleCount).toBe(1);
    expect(ledger.signal('k::direct')).toBeUndefined();
  });

  it('简单路径近期失败率偏高 ⇒ 升级：不再走快速路径（落到 direct 桶）', async () => {
    const ledger = new TaskOutcomeLedger();
    for (let i = 0; i < 3; i++) {
      ledger.record('k::simple', { path: 'simple', success: false });
    }
    const pdl = new PlanDrivenLoop({
      taorLoop: makeLoop(),
      deps: {} as TAORLoopDeps,
      sessionId: 's1',
      fastPathPolicy: POLICY,
      outcomeLedger: ledger,
      outcomeKey: 'k',
    });
    await pdl.run('你好');
    // 升级后未再写入 simple 桶（样本数不变），而是走了降级直执行
    expect(ledger.signal('k::simple')?.sampleCount).toBe(3);
    expect(ledger.signal('k::direct')?.sampleCount).toBe(1);
  });
});

describe('13-P1-1 Step 1: soft 路径依赖降级显式标注（buildPredecessorSummary）', () => {
  it('有产出 ⇒ 注入产出摘要，且无降级项（既有行为不变）', () => {
    const probes: DependencyProbe[] = [
      { description: '步骤A', output: 'A 的结论', status: 'ok' },
    ];
    const { summary, degraded } = buildPredecessorSummary(probes);
    expect(summary).toBe('- 步骤A：A 的结论');
    expect(degraded).toEqual([]);
  });

  it('无产出 + failed ⇒ 注入 [DEPENDENCY_DEGRADED] 标注行并登记降级项', () => {
    const probes: DependencyProbe[] = [
      { description: '步骤A', output: '', status: 'failed' },
    ];
    const { summary, degraded } = buildPredecessorSummary(probes);
    // 关键：前驱**不再静默消失**（原实现该行被 filter 掉）
    expect(summary).toContain('步骤A');
    expect(summary).toContain('[DEPENDENCY_DEGRADED]');
    expect(summary).toContain('执行失败');
    expect(degraded).toEqual(['步骤A（执行失败）']);
  });

  it('无产出 + skipped ⇒ 同样标注（措辞为「依赖阻断被跳过」）', () => {
    const probes: DependencyProbe[] = [
      { description: '步骤B', output: '', status: 'skipped' },
    ];
    const { summary, degraded } = buildPredecessorSummary(probes);
    expect(summary).toContain('[DEPENDENCY_DEGRADED]');
    expect(summary).toContain('依赖阻断被跳过');
    expect(degraded).toEqual(['步骤B（依赖阻断被跳过）']);
  });

  it('无产出 + ok（纯工具轮无文本）⇒ 不注入也不登记（与既有行为一致）', () => {
    const probes: DependencyProbe[] = [
      { description: '步骤A', output: '', status: 'ok' },
    ];
    expect(buildPredecessorSummary(probes)).toEqual({
      summary: '',
      degraded: [],
    });
  });

  it('无产出 + 状态未知（未执行/无记录）⇒ 不注入也不登记（与既有行为一致）', () => {
    const probes: DependencyProbe[] = [{ description: '步骤A', output: '' }];
    expect(buildPredecessorSummary(probes)).toEqual({
      summary: '',
      degraded: [],
    });
  });

  it('混合：正常前驱注入产出、失败前驱标注降级（仅失败项进 degraded）', () => {
    const probes: DependencyProbe[] = [
      { description: '步骤A', output: 'A 的结论', status: 'ok' },
      { description: '步骤B', output: '', status: 'failed' },
    ];
    const { summary, degraded } = buildPredecessorSummary(probes);
    const lines = summary.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('- 步骤A：A 的结论');
    expect(lines[1]).toContain('[DEPENDENCY_DEGRADED]');
    expect(degraded).toEqual(['步骤B（执行失败）']);
  });

  it('空探针 ⇒ 空摘要与空降级（无依赖步骤零影响）', () => {
    expect(buildPredecessorSummary([])).toEqual({ summary: '', degraded: [] });
  });

  it('产出摘要仍按 500 字符截断（既有语义不变）', () => {
    const probes: DependencyProbe[] = [
      { description: '步骤A', output: 'x'.repeat(600), status: 'ok' },
    ];
    const { summary } = buildPredecessorSummary(probes);
    expect(summary).toBe(`- 步骤A：${'x'.repeat(500)}`);
  });
});

// ── 13-P1-1 Step 2（2026-10-06，`任务计划-20261004.md` §20.6）：缺省 hard 翻转后的 PDL 行为 ──
// 覆盖三件事：① 前驱失败 ⇒ 后继**被阻断且不执行**（缺省 hard）；
//   ② `result.blockedSteps/skippedSteps` 暴露明细（供 PdcaLauncher 回灌模型）；
//   ③ `summary` 分母用**真实子任务数**且含阻断原因（原实现把"1/2 被阻断"显示成"1/1 成功"）。
describe('13-P1-1 Step 2: 缺省 hard 翻转后 PDL 阻断行为', () => {
  it('前驱失败 ⇒ 后继被阻断（不执行）、blockedSteps 有值、summary 含原因', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'pdl-step2-'));
    const prevDataDir = process.env.LIRI_DATA_DIR;
    process.env.LIRI_DATA_DIR = dataDir;
    // 计划持久化隔离（默认写 ~/.pyapp/data/plans/）
    taskOrchestrator.setPlansDir(join(dataDir, 'plans'));

    // 假 TAORLoop：任何一步都失败（前驱失败 ⇒ 后继应被阻断 ⇒ 不应该有第 2 个不同的步骤执行）
    let runCount = 0;
    const loop = {
      reset: () => {},
      runCollect: async () => {
        runCount += 1;
        throw new Error('simulated step failure');
      },
      getLastAssistantText: () => '',
    } as unknown as TAORLoop;

    const provider = {
      id: 'test-provider',
      displayName: 'Test Provider',
      chat: async () => ({
        content: JSON.stringify({
          mainTier: 'complex',
          reasoning: 'r',
          subTasks: [
            { id: 'step-1', description: '步骤A' },
            { id: 'step-2', description: '步骤B', dependsOn: ['step-1'] },
          ],
        }),
        model: 'test-model',
      }),
      listModels: async () => [],
      validateConfig: () => ({ valid: true, errors: [] }),
    } as unknown as AIProvider;

    try {
      const pdl = new PlanDrivenLoop({
        taorLoop: loop,
        deps: {} as TAORLoopDeps,
        sessionId: 's-step2',
        enableAutoDecompose: true,
        decomposerProvider: provider,
        // 注入判据：阈值压到 10 ⇒ 本消息必为 complex（走分解，不进快速路径）
        fastPathPolicy: {
          maxSimpleTaskLength: 10,
          dangerousIntentPatterns: [],
        },
      });
      const result = await pdl.run(
        '这是一个足够长的复杂任务描述，用于强制走分解路径而不是快速路径'
      );

      // ① 仅前驱被执行（1 次 + P0-2 重试 1 次）；后继被阻断，从未进入执行
      expect(runCount).toBe(2);
      expect(result.skippedSteps).toBe(1);
      // ② 明细可被上游（PdcaLauncher）消费回灌
      expect(result.blockedSteps).toHaveLength(1);
      expect(result.blockedSteps[0]!.description).toBe('步骤B');
      expect(result.blockedSteps[0]!.reason).toContain('step-1');
      // ③ 分母为真实子任务数（2），且阻断原因可见
      expect(result.summary).toContain('0/2 步骤成功');
      expect(result.summary).toContain('1 步骤因依赖阻断未执行');
      expect(result.summary).toContain('[依赖阻断明细]');
      expect(result.summary).toContain('步骤B');
    } finally {
      if (prevDataDir === undefined) delete process.env.LIRI_DATA_DIR;
      else process.env.LIRI_DATA_DIR = prevDataDir;
      // app.db 句柄可能未即时释放（Windows EBUSY）⇒ 重试删除，且清理失败不影响断言结果
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
    }
  });
});
