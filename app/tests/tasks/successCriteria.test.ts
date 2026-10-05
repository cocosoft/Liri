// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 13-P0-2（2026-10-05）：验收标准结构化（`SuccessCriteria`）守卫。
 *
 * 背景：《Agentic Design Patterns》21 模式复查 §13 A2 —— `acceptanceCriteria` 是自由文本，
 * 只进 Reviewer prompt，**未注入验证器** ⇒ 验证器 checks[] 由 LLM 自由发明，
 * 「你写的验收标准 ≠ 实际判定用的标准」。
 */
import { describe, it, expect } from 'bun:test';
import {
  parseSuccessCriteria,
  renderCriteriaSkeleton,
  alignChecksToCriteria,
} from '../../src/core/successCriteria.js';
import { VerifierAgent } from '../../src/query/VerifierAgent.js';
import type { VerificationInput } from '../../src/query/VerifierAgent.js';

describe('parseSuccessCriteria（自由文本 → 结构化）', () => {
  it('按换行/分号切分并剥离列表标记', () => {
    const c = parseSuccessCriteria('- 构建通过\n2) 测试全绿；* 无回归');
    expect(c?.items.map((i) => i.desc)).toEqual([
      '构建通过',
      '测试全绿',
      '无回归',
    ]);
    expect(c?.items.map((i) => i.id)).toEqual(['c1', 'c2', 'c3']);
    expect(c?.items.every((i) => i.check === 'llm')).toBe(true);
  });

  it('空/纯空白 ⇒ undefined（保持旧路径）', () => {
    expect(parseSuccessCriteria(undefined)).toBeUndefined();
    expect(parseSuccessCriteria('   ')).toBeUndefined();
    expect(parseSuccessCriteria('\n\n')).toBeUndefined();
  });
});

describe('renderCriteriaSkeleton', () => {
  it('按序渲染条目并声明唯一检查项集合', () => {
    const c = parseSuccessCriteria('甲\n乙')!;
    const text = renderCriteriaSkeleton(c);
    expect(text).toContain('c1. 甲');
    expect(text).toContain('c2. 乙');
    expect(text).toContain('禁止增删');
  });
});

describe('alignChecksToCriteria（判定骨架对齐）', () => {
  const criteria = parseSuccessCriteria('甲\n乙\n丙')!;

  it('未注入 criteria ⇒ 原样返回（零行为变化）', () => {
    const checks = [{ item: 'x', passed: true }];
    expect(alignChecksToCriteria(checks, undefined)).toEqual(checks);
  });

  it('同名/包含匹配 ⇒ 按 criteria 顺序重排，item 用 criteria 描述', () => {
    const aligned = alignChecksToCriteria(
      [
        { item: '乙是否满足', passed: false },
        { item: '甲', passed: true },
        { item: '丙', passed: true },
      ],
      criteria
    );
    expect(aligned.map((c) => c.item)).toEqual(['甲', '乙', '丙']);
    expect(aligned.map((c) => c.passed)).toEqual([true, false, true]);
  });

  it('漏项 ⇒ passed:false（漏项不复行）；骨架外项丢弃', () => {
    const aligned = alignChecksToCriteria(
      [
        { item: '甲', passed: true },
        { item: '模型自己发明的检查项', passed: true },
      ],
      criteria
    );
    expect(aligned).toHaveLength(3);
    expect(aligned.map((c) => c.passed)).toEqual([true, false, false]);
  });

  it('空 checks ⇒ 全条目 passed:false（不可空集假绿）', () => {
    const aligned = alignChecksToCriteria([], criteria);
    expect(aligned).toHaveLength(3);
    expect(aligned.every((c) => !c.passed)).toBe(true);
  });
});

describe('VerifierAgent × successCriteria（端到端）', () => {
  const input: VerificationInput = {
    messages: [{ role: 'user', content: 'do it' }],
    toolResults: [{ toolName: 'file_write', toolCallId: 't1', result: 'ok' }],
    turnCount: 1,
    sessionId: 's_criteria',
    successCriteria: parseSuccessCriteria('甲\n乙\n丙'),
  };

  it('模型少报一项 ⇒ checks 被补齐为骨架长度，且不放行', async () => {
    const agent = new VerifierAgent({ failClosed: true });
    agent.setCallModel(async function* () {
      yield {
        content: JSON.stringify({
          verdict: 'APPROVE',
          confidence: 0.9,
          checks: [
            { item: '甲', passed: true },
            { item: '乙', passed: true },
          ],
        }),
      };
    });
    const r = await agent.verify(input, new AbortController().signal);
    expect(r.checks?.map((c) => c.item)).toEqual(['甲', '乙', '丙']);
    expect(r.checks?.map((c) => c.passed)).toEqual([true, true, false]);
    // checkPassRate = 2/3（非 APPROVE 区间）⇒ 不放行
    expect(r.passed).toBe(false);
  });

  it('未注入 criteria ⇒ 保持模型返回的 checks（旧路径）', async () => {
    const agent = new VerifierAgent({ failClosed: true });
    agent.setCallModel(async function* () {
      yield {
        content: JSON.stringify({
          verdict: 'APPROVE',
          confidence: 0.9,
          checks: [{ item: '自由项', passed: true }],
        }),
      };
    });
    const r = await agent.verify(
      { ...input, successCriteria: undefined },
      new AbortController().signal
    );
    expect(r.checks).toEqual([{ item: '自由项', passed: true }]);
  });
});
