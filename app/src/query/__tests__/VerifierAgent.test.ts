/**
 * VerifierAgent 单元测试
 *
 * 覆盖 _parseResponse（双指标验证）、verify()、reset/getCycleCount。
 * Mock callModel 以避免真实模型调用。
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { VerifierAgent, createVerifierAgent } from '../VerifierAgent.js';
import type { VerificationInput } from '../VerifierAgent.js';

function makeInput(overrides?: Partial<VerificationInput>): VerificationInput {
  return {
    messages: [{ role: 'user', content: 'test' }],
    toolResults: [
      {
        toolName: 'write_file',
        toolCallId: 't1',
        result: 'file written successfully',
      },
    ],
    turnCount: 1,
    sessionId: 'test-session',
    ...overrides,
  };
}

// ─── helpers ───────────────────────────────────────────

/** 创建一个模拟 callModel，返回指定 JSON 字符串 */
function mockCallModel(jsonResponse: string) {
  return async function* (
    _messages: Array<{ role: string; content: string }>,
    _signal: AbortSignal
  ): AsyncGenerator<{ content?: string }> {
    yield { content: jsonResponse };
  };
}

/** 创建一个带 checks 数组的 JSON 响应 */
function checksJson(
  checks: Array<{ item: string; passed: boolean }>,
  confidence = 0.8,
  verdict = 'APPROVE'
) {
  return JSON.stringify({ verdict, confidence, checks });
}

describe('VerifierAgent', () => {
  // ─── _parseResponse（双指标验证） ────────────────────

  describe('_parseResponse — 双指标验证', () => {
    let agent: VerifierAgent;

    beforeEach(() => {
      agent = new VerifierAgent();
    });

    test('全部 checks 通过 + 高置信度 → APPROVE', () => {
      const json = checksJson(
        [
          { item: '修改是否完成目标', passed: true },
          { item: '是否引入新错误', passed: true },
          { item: '是否破坏已有功能', passed: true },
          { item: '是否遵循编码规范', passed: true },
          { item: '是否遗漏边界情况', passed: true },
        ],
        0.85
      );

      // 通过 verify 间接测试 _parseResponse
      agent.setCallModel(mockCallModel(json));

      const input = makeInput();
      const signal = new AbortController().signal; // never aborted
      // 用 Promise.race + timeout 避免无无限等待
      const result = Promise.resolve().then(() => {
        // 直接测试 _parseResponse
        const parsed = (agent as any)._parseResponse(json);
        expect(parsed.passed).toBe(true);
        expect(parsed.verdict).toBe('APPROVE');
        expect(parsed.checkPassRate).toBe(1.0);
        expect(parsed.checks).toHaveLength(5);
      });
      return result;
    });

    test('checkPassRate < 0.5 → 强制 REJECT（不看 confidence）', () => {
      const json = checksJson(
        [
          { item: '修改是否完成目标', passed: false },
          { item: '是否引入新错误', passed: false },
          { item: '是否破坏已有功能', passed: false },
          { item: '是否遵循编码规范', passed: true },
          { item: '是否遗漏边界情况', passed: false },
        ],
        0.9
      ); // 高置信度但 checks 大部分不通过

      const parsed = (agent as any)._parseResponse(json);
      expect(parsed.passed).toBe(false);
      expect(parsed.verdict).toBe('REJECT');
      expect(parsed.checkPassRate).toBe(0.2);
    });

    test('checkPassRate >= 0.8 && confidence >= 0.6 → APPROVE', () => {
      const json = checksJson(
        [
          { item: '修改是否完成目标', passed: true },
          { item: '是否引入新错误', passed: true },
          { item: '是否破坏已有功能', passed: true },
          { item: '是否遵循编码规范', passed: true },
          { item: '是否遗漏边界情况', passed: false },
        ],
        0.7
      ); // 4/5 = 0.8, confidence 0.7 >= 0.6

      const parsed = (agent as any)._parseResponse(json);
      expect(parsed.passed).toBe(true);
      expect(parsed.verdict).toBe('APPROVE');
      expect(parsed.checkPassRate).toBe(0.8);
    });

    test('checkPassRate >= 0.5 && confidence < 0.6 → ESCALATE', () => {
      const json = checksJson(
        [
          { item: '修改是否完成目标', passed: true },
          { item: '是否引入新错误', passed: true },
          { item: '是否破坏已有功能', passed: false },
          { item: '是否遵循编码规范', passed: true },
          { item: '是否遗漏边界情况', passed: false },
        ],
        0.5
      ); // 3/5 = 0.6, confidence 0.5 < 0.6

      const parsed = (agent as any)._parseResponse(json);
      expect(parsed.passed).toBe(false);
      expect(parsed.verdict).toBe('ESCALATE');
    });

    test('checkPassRate >= 0.5 && confidence >= 0.6 && 原始 verdict 非 APPROVE → 按双指标走', () => {
      const json = checksJson(
        [
          { item: '修改是否完成目标', passed: true },
          { item: '是否引入新错误', passed: true },
          { item: '是否破坏已有功能', passed: true },
          { item: '是否遵循编码规范', passed: true },
          { item: '是否遗漏边界情况', passed: false },
        ],
        0.75,
        'REJECT'
      ); // LLM 判 REJECT 但 checks 4/5 + high confidence

      const parsed = (agent as any)._parseResponse(json);
      // checkPassRate >= 0.8 && confidence >= 0.6 → APPROVE（双指标覆盖 LLM 判定）
      expect(parsed.passed).toBe(true);
      expect(parsed.verdict).toBe('APPROVE');
    });

    test('无 checks 数据 → 退回到单指标判定（兼容旧格式）', () => {
      const json = JSON.stringify({ verdict: 'APPROVE', confidence: 0.9 });

      const parsed = (agent as any)._parseResponse(json);
      expect(parsed.passed).toBe(true);
      expect(parsed.verdict).toBe('APPROVE');
      expect(parsed.checkPassRate).toBeUndefined();
      expect(parsed.checks).toBeUndefined();
    });

    test('无 checks 且 confidence 低于阈值 → REJECT', () => {
      const agentLow = new VerifierAgent({ confidenceThreshold: 0.8 });
      const json = JSON.stringify({ verdict: 'APPROVE', confidence: 0.6 });

      const parsed = (agentLow as any)._parseResponse(json);
      expect(parsed.passed).toBe(false);
    });

    test('JSON 解析失败 → 降级为 APPROVE', () => {
      const json = 'not valid json at all {{{';

      const parsed = (agent as any)._parseResponse(json);
      expect(parsed.passed).toBe(true);
      expect(parsed.verdict).toBe('APPROVE');
      expect(parsed.confidence).toBe(0.3);
    });

    test('JSON 在 markdown 代码块中也能正确解析', () => {
      const inner = checksJson(
        [
          { item: '检查A', passed: true },
          { item: '检查B', passed: true },
        ],
        0.8
      );
      const json = '```json\n' + inner + '\n```';

      const parsed = (agent as any)._parseResponse(json);
      expect(parsed.passed).toBe(true);
      expect(parsed.checks).toHaveLength(2);
    });

    test('verdict 非法值 → 退回到双指标判定', () => {
      const json = checksJson(
        [
          { item: '检查A', passed: true },
          { item: '检查B', passed: false },
        ],
        0.9,
        'INVALID'
      );

      const parsed = (agent as any)._parseResponse(json);
      // 原始 verdict 不合规，但 checks 1/2, checkPassRate=0.5, confidence=0.9
      // checkPassRate >= 0.5 且 confidence >= 0.6 → 进入 else 分支 → REJECT（安全违约）
      expect(parsed.verdict).toBe('REJECT');
    });

    test('feedback 在 REJECT 时返回', () => {
      const inner = JSON.stringify({
        verdict: 'REJECT',
        confidence: 0.3,
        checks: [{ item: '检查A', passed: false }],
        feedback: '文件写入后未验证内容',
      });
      const json = '```json\n' + inner + '\n```';

      const parsed = (agent as any)._parseResponse(json);
      expect(parsed.feedback).toBe('文件写入后未验证内容');
    });
  });

  // ─── verify ──────────────────────────────────────────

  describe('verify', () => {
    test('enabled=false → 直接返回 APPROVE', async () => {
      const agent = new VerifierAgent({ enabled: false });
      const input = makeInput();
      const signal = new AbortController().signal;

      const result = await agent.verify(input, signal);
      expect(result.passed).toBe(true);
      expect(result.verdict).toBe('APPROVE');
      expect(result.confidence).toBe(1.0);
    });

    test('未设置 callModel → 跳过验证返回 APPROVE', async () => {
      const agent = new VerifierAgent();
      const input = makeInput();
      const signal = new AbortController().signal;

      const result = await agent.verify(input, signal);
      expect(result.passed).toBe(true);
      expect(result.verdict).toBe('APPROVE');
      expect(result.confidence).toBe(0.5);
    });

    test('验证模型返回 APPROVE → 通过', async () => {
      const agent = new VerifierAgent();
      agent.setCallModel(
        mockCallModel(
          checksJson(
            [
              { item: '检查A', passed: true },
              { item: '检查B', passed: true },
            ],
            0.9
          )
        )
      );

      const input = makeInput();
      const signal = new AbortController().signal;

      const result = await agent.verify(input, signal);
      expect(result.passed).toBe(true);
      expect(result.verdict).toBe('APPROVE');
    });

    test('验证模型返回 REJECT → 不通过', async () => {
      const agent = new VerifierAgent();
      agent.setCallModel(
        mockCallModel(
          checksJson(
            [
              { item: '检查A', passed: false },
              { item: '检查B', passed: false },
            ],
            0.3,
            'REJECT'
          )
        )
      );

      const input = makeInput();
      const signal = new AbortController().signal;

      const result = await agent.verify(input, signal);
      expect(result.passed).toBe(false);
      expect(result.verdict).toBe('REJECT');
    });

    test.skip('验证过程中 callModel 抛出异常 → 降级为 APPROVE', async () => {
      const agent = new VerifierAgent();
      agent.setCallModel(async function* () {
        throw new Error('model timeout');
      });

      const input = makeInput();
      const signal = new AbortController().signal;

      const result = await agent.verify(input, signal);
      expect(result.passed).toBe(true);
      expect(result.verdict).toBe('APPROVE');
      expect(result.confidence).toBe(0.3);
    });
  });

  // ─── cycleCount ──────────────────────────────────────

  describe('cycleCount', () => {
    test('初始 cycleCount 为 0', () => {
      const agent = new VerifierAgent();
      expect(agent.getCycleCount()).toBe(0);
    });

    test('每次 verify 后 cycleCount 自增', async () => {
      const agent = new VerifierAgent();
      agent.setCallModel(
        mockCallModel(checksJson([{ item: '检查A', passed: true }], 0.9))
      );

      const signal = new AbortController().signal;

      expect(agent.getCycleCount()).toBe(0);
      await agent.verify(makeInput(), signal);
      expect(agent.getCycleCount()).toBe(1);
      await agent.verify(makeInput(), signal);
      expect(agent.getCycleCount()).toBe(2);
    });

    test('cycleCount 达到 maxCycles → 强制 ESCALATE', async () => {
      const agent = new VerifierAgent({ maxCycles: 2 });
      agent.setCallModel(
        mockCallModel(
          checksJson([{ item: '检查A', passed: false }], 0.3, 'REJECT')
        )
      );

      const signal = new AbortController().signal;

      // 第 1 次：正常 REJECT
      await agent.verify(makeInput(), signal);
      // 第 2 次：cycleCount=1，正常 REJECT
      await agent.verify(makeInput(), signal);
      // 第 3 次：cycleCount>=2，强制 ESCALATE
      const result = await agent.verify(makeInput(), signal);
      expect(result.passed).toBe(false);
      expect(result.verdict).toBe('ESCALATE');
      expect(result.feedback).toContain('上限');
    });

    test('reset 将 cycleCount 归零', async () => {
      const agent = new VerifierAgent();
      agent.setCallModel(
        mockCallModel(checksJson([{ item: '检查A', passed: true }], 0.9))
      );

      const signal = new AbortController().signal;

      await agent.verify(makeInput(), signal);
      await agent.verify(makeInput(), signal);
      expect(agent.getCycleCount()).toBe(2);

      agent.reset();
      expect(agent.getCycleCount()).toBe(0);
    });

    test('Teamwork P2b：REJECT 时触发 recordPitfall（注入钩子，验收 #5 写点）', async () => {
      const recorded: Array<Record<string, unknown>> = [];
      const agent = new VerifierAgent({
        enabled: true,
        maxCycles: 1,
        confidenceThreshold: 0.7,
        timeoutMs: 5000,
        recordPitfall: (rec) => recorded.push({ ...rec }),
      });
      agent.setCallModel(
        mockCallModel(
          JSON.stringify({
            verdict: 'REJECT',
            confidence: 0.9,
            checks: [
              { item: '结果准确', passed: false },
              { item: '引用完整', passed: true },
            ],
            feedback: '候选缺关键数据来源，结论不可信',
          })
        )
      );

      const signal = new AbortController().signal;
      const result = await agent.verify(makeInput(), signal);
      expect(result.verdict).toBe('REJECT');
      expect(recorded).toHaveLength(1);
      expect(recorded[0]?.description).toContain('write_file');
      expect(recorded[0]?.error).toContain('数据来源');
      expect(recorded[0]?.source).toBe('verifier');
    });

    test('Teamwork P2b：APPROVE 不触发 recordPitfall', async () => {
      const recorded: Array<Record<string, unknown>> = [];
      const agent = new VerifierAgent({
        enabled: true,
        maxCycles: 1,
        confidenceThreshold: 0.7,
        timeoutMs: 5000,
        recordPitfall: (rec) => recorded.push({ ...rec }),
      });
      agent.setCallModel(
        mockCallModel(checksJson([{ item: '检查A', passed: true }], 0.95))
      );

      const signal = new AbortController().signal;
      await agent.verify(makeInput(), signal);
      expect(recorded).toHaveLength(0);
    });
  });

  // ─── 工厂函数 ────────────────────────────────────────

  describe('createVerifierAgent', () => {
    test('createVerifierAgent 创建可用实例', () => {
      const agent = createVerifierAgent();
      expect(agent).toBeInstanceOf(VerifierAgent);
      expect(agent.getCycleCount()).toBe(0);
    });

    test('createVerifierAgent 支持自定义配置', () => {
      const agent = createVerifierAgent({
        maxCycles: 5,
        confidenceThreshold: 0.9,
      });
      expect(agent.getCycleCount()).toBe(0);
      // enabled 默认 true
      const disabledAgent = createVerifierAgent({ enabled: false });
      expect(disabledAgent.getCycleCount()).toBe(0);
    });
  });
});
