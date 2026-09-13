// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * PlanDrivenLoop._executeDecomposed 验证 harness（Teamwork P0-1 基础批次，2026-09-06）
 *
 * 背景：decompose 分支在常规聊天分流下不可达（方案文档"可达性发现"），
 * 故用本 harness 直接驱动 PDL.run(复杂消息) + stub decomposer/TAORLoop，
 * 验证 P0-1 语义：拓扑批次顺序、前驱产出注入、步骤产出捕获、P0-2 失败门控重试与
 * recordPitfall 钩子。不触网（fake TAORLoop 返回 canned 产出）。
 */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlanDrivenLoop } from './PlanDrivenLoop.js';
import type { TAORLoop } from '@modules/query/TAORLoop.js';
import type { TAORLoopDeps } from '@modules/query/TAORLoop.js';
import type { AIProvider } from '@modules/ai/providers/AIProvider.js';
import { taskOrchestrator } from '../../tasks/TaskOrchestrator.js';

// 与 batchParallel.test.ts 同模式：真实 taskOrchestrator 单例 + 临时 plans 目录隔离，
// 避免污染用户数据（~/.pyapp/data/plans/）。resolveWorkspaceId 的 DB 缺失由内部 catch 吞并返回 undefined。
taskOrchestrator.setPlansDir(mkdtempSync(join(tmpdir(), 'pdl-harness-')));

interface FakeTaorOptions {
  /** desc → 本步产出文本（缺省自动生成） */
  outputs?: Record<string, string>;
  /** 命中这些 desc 的第一步 runCollect 抛错（P0-2 重试触发） */
  failDescs?: string[];
  /** 每个 failDesc 最多失败次数（默认 1；设 Infinity 则两败终败） */
  failTimes?: number;
  /** 模拟 LLM 耗时 ms（真并行用例需要真实并发窗口以观测 maxActive） */
  delayMs?: number;
  /** 共享并发计数器（跨工厂实例累计活跃执行峰值） */
  tracker?: { active: number; maxActive: number };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** PDL 每步 runCollect 只消费 {messages[0].content}；产出捕获走 getLastAssistantText */
class FakeTaor {
  promptLog: string[] = [];
  private failCount = new Map<string, number>();
  private lastText = '';
  constructor(private cfg: FakeTaorOptions) {}

  reset(): void {
    this.lastText = '';
  }
  abort(_save?: boolean): Promise<void> | void {
    return undefined;
  }
  async runCollect(input: { messages?: Array<{ content?: string }> }): Promise<{
    turnCount: number;
    totalTokens: number;
    durationMs: number;
    terminationReason: string;
    resumed: boolean;
  }> {
    const prompt = input.messages?.[0]?.content ?? '';
    this.promptLog.push(prompt);
    const tracker = this.cfg.tracker;
    if (tracker) {
      tracker.active++;
      tracker.maxActive = Math.max(tracker.maxActive, tracker.active);
    }
    try {
      if (this.cfg.delayMs) await sleep(this.cfg.delayMs);
      const desc = this.parseDesc(prompt);
      const fails = this.failCount.get(desc) ?? 0;
      const maxFail = this.cfg.failTimes ?? 1;
      if (this.cfg.failDescs?.includes(desc) && fails < maxFail) {
        this.failCount.set(desc, fails + 1);
        // P1-3 语义（2026-09-06）：真实 TAOR 失败时 messages 保留中间 assistant 文本，
        // getLastAssistantText() 有值——fake 同步保留失败前产出片段供 partialOutput 断言
        this.lastText = `（${desc} 失败前的部分产出片段）`;
        throw new Error('simulated step failure (harness)');
      }
      this.lastText = this.cfg.outputs?.[desc] ?? `产出：${desc} 完成`;
      return {
        turnCount: 1,
        totalTokens: 10,
        durationMs: 5,
        terminationReason: 'completed',
        resumed: false,
      };
    } finally {
      if (tracker) tracker.active--;
    }
  }
  getLastAssistantText(): string {
    return this.lastText;
  }
  private parseDesc(prompt: string): string {
    const m = prompt.match(/当前步骤：([^\n]+)/);
    return m ? m[1].trim() : '';
  }
}

/** 返回"复杂消息"（字符数 > 60 的 SIMPLE_TASK_MAX_LENGTH 阈值）以命中 decompose 分支 */
const COMPLEX_MESSAGE =
  '请帮我完成一份完整的多步骤研究写作任务，包含资料收集、结构设计、初稿撰写、逐段校对、参考文献整理与最终发布排期，并给出每一步的验收标准，方便后续分步执行与验证交付质量。';

/** 链式分解：a→b→c（b 依赖 a、c 依赖 b），含前向后置依赖排序语义 */
const CHAIN_DECOMPOSITION = {
  mainTier: 'medium',
  subTasks: [
    { id: 'a', description: '写大纲', tier: 'medium', dependsOn: [] },
    { id: 'b', description: '写正文', tier: 'medium', dependsOn: ['a'] },
    { id: 'c', description: '校对发布', tier: 'medium', dependsOn: ['b'] },
  ],
  reasoning: 'harness 固定分解',
};

/** 无依赖分解：a、b、c 相互独立 → 同一拓扑批次，可并行候选 */
const PARALLEL_DECOMPOSITION = {
  mainTier: 'medium',
  subTasks: [
    { id: 'p1', description: '收集资料', tier: 'medium', dependsOn: [] },
    { id: 'p2', description: '绘制图表', tier: 'medium', dependsOn: [] },
    { id: 'p3', description: '撰写初稿', tier: 'medium', dependsOn: [] },
  ],
  reasoning: 'harness 固定分解',
};

function buildDecomposerProvider(
  decomposition: typeof CHAIN_DECOMPOSITION
): AIProvider {
  return {
    id: 'fake-decomposer',
    chat: async () => ({
      content: JSON.stringify(decomposition),
      model: 'fake-model',
    }),
  } as unknown as AIProvider;
}

function buildLoop(
  taor: FakeTaor,
  opts: {
    recordPitfall?: (rec: unknown) => void;
    taorLoopFactory?: (sessionId: string) => FakeTaor;
    decomposition?: typeof CHAIN_DECOMPOSITION;
  }
): PlanDrivenLoop {
  return new PlanDrivenLoop({
    taorLoop: taor as unknown as TAORLoop,
    ...(opts.taorLoopFactory
      ? {
          taorLoopFactory: (sid: string) =>
            opts.taorLoopFactory!(sid) as unknown as TAORLoop,
        }
      : {}),
    deps: {} as TAORLoopDeps,
    sessionId: 'session_harness',
    taskId: 'pdca_harness',
    enableAutoDecompose: true,
    decomposerProvider: buildDecomposerProvider(
      opts.decomposition ?? CHAIN_DECOMPOSITION
    ),
    recordPitfall: opts.recordPitfall,
  });
}

describe('PlanDrivenLoop._executeDecomposed（P0-1 基础批次 harness）', () => {
  it('链式依赖：拓扑顺序执行 + 前驱产出注入 + 每步产出捕获', async () => {
    const taor = new FakeTaor({
      outputs: { 写大纲: 'A输出', 写正文: 'B输出', 校对发布: 'C输出' },
    });
    const loop = buildLoop(taor, {});
    const res = await loop.run(COMPLEX_MESSAGE);

    expect(res.decomposed).toBe(true);
    expect(res.completedSteps).toBe(3);
    expect(res.failedSteps).toBe(0);

    // 执行顺序：a(写大纲) → b(写正文) → c(校对发布)
    const findIdx = (desc: string) =>
      taor.promptLog.findIndex((p) => p.includes(`当前步骤：${desc}`));
    expect(findIdx('写大纲')).toBeGreaterThanOrEqual(0);
    expect(findIdx('写正文')).toBeGreaterThan(findIdx('写大纲'));
    expect(findIdx('校对发布')).toBeGreaterThan(findIdx('写正文'));

    // 前驱产出注入：b 的 prompt 含 a 的输出；c 的含 b 的输出
    const promptB = taor.promptLog[findIdx('写正文')];
    const promptC = taor.promptLog[findIdx('校对发布')];
    expect(promptB).toContain('依赖前驱结果');
    expect(promptB).toContain('A输出');
    expect(promptC).toContain('B输出');
  });

  it('P0-2 失败门控重试：首败注入 objection 重跑 1 次后成功', async () => {
    const taor = new FakeTaor({
      outputs: { 写大纲: 'A输出', 写正文: 'B输出', 校对发布: 'C输出' },
      failDescs: ['写正文'],
      failTimes: 1,
    });
    const loop = buildLoop(taor, {});
    const res = await loop.run(COMPLEX_MESSAGE);

    expect(res.completedSteps).toBe(3);
    expect(res.failedSteps).toBe(0);
    // 写正文跑了 2 次（首败 + 重试成功），第二次 prompt 带 objection
    const bPrompts = taor.promptLog.filter((p) =>
      p.includes('当前步骤：写正文')
    );
    expect(bPrompts.length).toBe(2);
    expect(bPrompts[1]).toContain('[上一步尝试失败]');
    expect(bPrompts[1]).toContain('simulated step failure');
  });

  it('P0-2 重试仍失败：markStepFailed + recordPitfall 钩子触发（批次隔离预留）', async () => {
    const taor = new FakeTaor({
      failDescs: ['写正文'],
      failTimes: 999, // 恒败 → 两败终败
    });
    const pitfallRecs: unknown[] = [];
    const loop = buildLoop(taor, { recordPitfall: (r) => pitfallRecs.push(r) });
    const res = await loop.run(COMPLEX_MESSAGE);

    expect(res.completedSteps).toBe(2); // a、c 成功
    expect(res.failedSteps).toBe(1); // b 终败
    expect(pitfallRecs.length).toBe(1);
    const rec = pitfallRecs[0] as {
      stepId: string;
      taskId?: string;
      description: string;
      error: string;
    };
    expect(rec.description).toBe('写正文');
    expect(rec.error).toContain('simulated step failure');
    // P1-3（2026-09-06）：失败路线保留——失败步骤的 partialOutput 含失败前产出片段
    const failedStep = res.stepResults.find((r) => r.state === 'failed');
    expect(failedStep?.description).toBe('写正文');
    expect(failedStep?.partialOutput).toContain('写正文 失败前的部分产出片段');
    // b 两败：首败 + 终败各一次 runCollect
    const bPrompts = taor.promptLog.filter((p) =>
      p.includes('当前步骤：写正文')
    );
    expect(bPrompts.length).toBe(2);
  });

  it('真并行：无依赖步骤 + 每步独立实例工厂 → 同批并发执行（maxActive ≥ 2）', async () => {
    const tracker = { active: 0, maxActive: 0 };
    const mainTaor = new FakeTaor({}); // 本用例 decomposed 全部步走工厂，主实例仅兜底
    const loop = buildLoop(mainTaor, {
      decomposition: PARALLEL_DECOMPOSITION,
      taorLoopFactory: () => new FakeTaor({ delayMs: 40, tracker }),
    });
    const res = await loop.run(COMPLEX_MESSAGE);

    expect(res.completedSteps).toBe(3);
    expect(res.failedSteps).toBe(0);
    // 并发观测：3 个独立步骤同一拓扑批次同时启动，活跃执行峰值应 ≥ 2（真并行证据）
    expect(tracker.maxActive).toBeGreaterThan(1);
  });

  it('未注入工厂：无依赖步骤保持逐步骤串行（现状零回归）', async () => {
    const tracker = { active: 0, maxActive: 0 };
    const mainTaor = new FakeTaor({ delayMs: 20, tracker });
    const loop = buildLoop(mainTaor, { decomposition: PARALLEL_DECOMPOSITION });
    const res = await loop.run(COMPLEX_MESSAGE);

    expect(res.completedSteps).toBe(3);
    expect(res.failedSteps).toBe(0);
    // 未注入每步独立实例工厂 → 无并发窗口，活跃峰值恒为 1（与改造前行为一致）
    expect(tracker.maxActive).toBe(1);
  });
});
