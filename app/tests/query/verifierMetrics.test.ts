/**
 * G-3（2026-10-18）验证器指标 + 主对话独立模型接线守卫。
 *
 * 验收锚点（清单 §6 G-3）：
 * - 配置 verifier 角色后，日志/追踪可见两个不同模型；
 * - **未配置时行为零变化**（不注入 `verifierModel`）；
 * - 新增指标（耗时 / 拒绝率 / 误拦样本）。
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  recordVerifierResult,
  getVerifierMetrics,
  resetVerifierMetrics,
} from '../../src/query/taor/verifierMetrics';

const APP_ROOT = resolve(import.meta.dir, '../..');
const read = (rel: string) => readFileSync(join(APP_ROOT, rel), 'utf8');

beforeEach(() => {
  resetVerifierMetrics();
});

describe('G-3 验证器指标', () => {
  it('累计 verdict 与拒绝率 / 升级率 / 平均耗时', () => {
    recordVerifierResult({
      sessionId: 's1',
      turn: 1,
      verdict: 'APPROVE',
      durationMs: 100,
    });
    recordVerifierResult({
      sessionId: 's1',
      turn: 2,
      verdict: 'REJECT',
      durationMs: 200,
      feedback: '缺少边界检查',
    });
    recordVerifierResult({
      sessionId: 's2',
      turn: 1,
      verdict: 'ESCALATE',
      durationMs: 300,
    });

    const m = getVerifierMetrics();
    expect(m.total).toBe(3);
    expect(m.approved).toBe(1);
    expect(m.rejected).toBe(1);
    expect(m.escalated).toBe(1);
    expect(m.rejectRate).toBeCloseTo(1 / 3, 5);
    expect(m.escalateRate).toBeCloseTo(1 / 3, 5);
    expect(m.avgDurationMs).toBeCloseTo(200, 5);
  });

  it('误拦样本：只记 REJECT，反馈截断到 200 字符，新 → 旧', () => {
    recordVerifierResult({
      sessionId: 's1',
      turn: 3,
      verdict: 'REJECT',
      durationMs: 10,
      feedback: 'A'.repeat(500),
    });
    recordVerifierResult({
      sessionId: 's2',
      turn: 4,
      verdict: 'REJECT',
      durationMs: 10,
      feedback: 'later',
    });
    recordVerifierResult({
      sessionId: 's3',
      turn: 5,
      verdict: 'APPROVE',
      durationMs: 10,
    });

    const samples = getVerifierMetrics().rejectSamples;
    expect(samples).toHaveLength(2);
    expect(samples[0].feedback).toBe('later');
    expect(samples[1].feedback.length).toBe(200);
    expect(samples[0].sessionId).toBe('s2');
  });

  it('样本有界：最多保留 20 条', () => {
    for (let i = 0; i < 30; i++) {
      recordVerifierResult({
        sessionId: `s${i}`,
        turn: i,
        verdict: 'REJECT',
        durationMs: 1,
        feedback: `f${i}`,
      });
    }
    const samples = getVerifierMetrics().rejectSamples;
    expect(samples).toHaveLength(20);
    expect(samples[0].feedback).toBe('f29'); // 最新在前
  });

  it('空指标：比率与均值为 0（不产生 NaN）', () => {
    const m = getVerifierMetrics();
    expect(m).toMatchObject({
      total: 0,
      rejectRate: 0,
      escalateRate: 0,
      avgDurationMs: 0,
      rejectSamples: [],
    });
  });

  it('VerifierAgent.verify 真实记账：未注入 callModel + fail-closed ⇒ 计入 ESCALATE', async () => {
    const { VerifierAgent } = await import('../../src/query/VerifierAgent');
    const agent = new VerifierAgent({ enabled: true, failClosed: true });
    const result = await agent.verify(
      { messages: [], toolResults: [], turnCount: 7, sessionId: 'g3-runtime' },
      new AbortController().signal
    );
    expect(result.verdict).toBe('ESCALATE');
    // 跨文件可能并发写同一进程指标 ⇒ 只断言「至少记了一次」，避免假红
    expect(getVerifierMetrics().escalated).toBeGreaterThanOrEqual(1);
  });

  it('快照是副本：外部修改不影响内部状态', () => {
    recordVerifierResult({
      sessionId: 's1',
      turn: 1,
      verdict: 'REJECT',
      durationMs: 5,
      feedback: 'x',
    });
    const m = getVerifierMetrics();
    m.rejectSamples.push({
      sessionId: 'evil',
      turn: 0,
      feedback: '',
      at: '',
    });
    expect(getVerifierMetrics().rejectSamples).toHaveLength(1);
  });
});

describe('G-3 主对话接线守卫', () => {
  it('ChatManager 按 verifier 角色解析并注入（未配置不注入）', () => {
    const src = read('src/chat/ChatManager.ts');
    // issue #17 · D7（2026-10-29）：解析/幂等实现已外移到 `manager/verifierModel.ts`，
    // 扫描面随实现迁移（断言强度不变）：① 角色解析 + ④ 幂等 → 模块；② 入口 await + ③ 条件注入 → 宿主。
    const impl = read('src/chat/manager/verifierModel.ts');
    // ① 角色解析
    expect(impl).toContain("resolveRoleModel('verifier')");
    // ② 入口 await（在建 TAOR 实例之前）
    expect(src).toContain('await this._ensureVerifierCallModel()');
    // ③ 条件注入：未配置 ⇒ 不出现 `verifierModel` 键
    expect(src).toContain('...(this._verifier.callModel');
    expect(src).toContain('{ verifierModel: this._verifier.callModel }');
    // ④ 幂等：解析只进行一次
    expect(impl).toContain('if (state.resolved) return state.resolved');
  });

  it('VerifierAgent 是唯一采集收口点（计时 + verdict + 输入键）', () => {
    const src = read('src/query/VerifierAgent.ts');
    // ① 计时包裹内部实现（`_verifyInner` 保持原判定逻辑不变）
    expect(src).toContain(
      'const result = await this._verifyInner(input, signal)'
    );
    expect(src).toContain('const startedAt = Date.now()');
    // ② 记账：按输入自带 sessionId / turnCount，无业务分支参与
    expect(src).toContain('recordVerifierResult({');
    expect(src).toContain('sessionId: input.sessionId');
    expect(src).toContain('turn: input.turnCount');
    expect(src).toContain('durationMs: Date.now() - startedAt');
    // ③ 用户显式关闭验证 ⇒ 不记账（直接返回，不经采集）
    expect(src).toContain(
      "if (!this.config.enabled) {\n      return { passed: true, confidence: 1.0, verdict: 'APPROVE' };\n    }\n    const startedAt"
    );
  });
});
