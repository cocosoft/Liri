/**
 * P2-1d-2 —— S6 **retry 段**纯助手契约测试（2026-10-10）。
 *
 * 依据：`.trae/specs/stream-message-flow-split.md` §3-S6 / §5；实现见
 * `src/chat/orchestrator/streamMessageHelpers.ts`。
 *
 * 锁定：
 * 1. **续写消息构造**：追加 `assistant(已生成)` + `user(续写指令)`，且**不改原数组**（纯）；
 * 2. **文案单一来源**：截断提示字面量**不再**出现在 `streamMessageFlow.ts`
 *    （防"落盘事件与前端 chunk 各写一遍"的漂移回流 —— 该漂移正是本切片修掉的）。
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildTruncationContinueMessages,
  TRUNCATION_CONTINUE_INSTRUCTION,
  TRUNCATION_DEGRADE_RETRY_NOTICE,
  TRUNCATION_NO_CONTENT_FINAL_NOTICE,
  truncationLargerBudgetNotice,
} from '../../../src/chat/orchestrator/streamMessageHelpers.js';

const SRC = join(import.meta.dir, '../../../src/chat/orchestrator');

describe('P2-1d-2 S6 retry 段 · 纯助手', () => {
  it('`buildTruncationContinueMessages` 追加「已生成 assistant + 续写 user」且**不改原数组**', () => {
    const original: Array<Record<string, unknown>> = [
      { role: 'user', content: '问题' },
    ];
    const snapshot = JSON.parse(JSON.stringify(original));
    const next = buildTruncationContinueMessages(original, '已生成正文');

    expect(next).toHaveLength(3);
    expect(next[1]).toEqual({ role: 'assistant', content: '已生成正文' });
    expect(next[2]).toEqual({
      role: 'user',
      content: TRUNCATION_CONTINUE_INSTRUCTION,
    });
    // 纯函数：原数组未被改动
    expect(original).toEqual(snapshot);
    expect(next).not.toBe(original);
  });

  it('`truncationLargerBudgetNotice` 单一来源：含重试次数与目标 maxTokens', () => {
    const s = truncationLargerBudgetNotice({
      retryCount: 2,
      nextMaxTokens: 32000,
    });
    expect(s).toContain('第 2 次');
    expect(s).toContain('maxTokens=32000');
  });

  it('三条截断提示互不相同（防误合并）', () => {
    const a = TRUNCATION_DEGRADE_RETRY_NOTICE;
    const b = TRUNCATION_NO_CONTENT_FINAL_NOTICE;
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
  });

  it('【防回流】截断提示字面量**不再**出现在 `streamMessageFlow.ts`（单一来源在 helpers）', () => {
    const flow = readFileSync(join(SRC, 'streamMessageFlow.ts'), 'utf-8');
    const helpers = readFileSync(join(SRC, 'streamMessageHelpers.ts'), 'utf-8');

    // 这 4 条提示曾各自在「事件」与「chunk」重复出现 ⇒ 必须只在 helpers 里。
    // ⚠️ 片段须取到**区分本次收敛范围**的粒度：`请从中断处继续刚才的回答` 亦出现在
    // 另一条**不同触发**的续写提示（`输出已中断…`，:679，非本次范围）⇒ 用整句锁定。
    for (const fragment of [
      '正在以收敛指令 + 更小输出预算重试 1 次',
      '建议增大 maxTokens、减小上下文',
      '正在以更大 token 限制重试',
      '输出已截断。请从中断处继续刚才的回答',
    ]) {
      expect(flow.includes(fragment)).toBe(false);
      expect(helpers.includes(fragment)).toBe(true);
    }
  });
});
