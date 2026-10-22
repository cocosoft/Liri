/**
 * 回复详略档契约测试（`/effort` 后端接线，2026-10-22）
 *
 * 接线前：`/effort` 只写 `context.environment.EFFORT_LEVEL`，聊天链路**零读取**
 * ⇒ 命令"看起来生效"但回复行为不变。
 * 本用例锁住契约与接线点：
 *  - 归一化：非法/未设置 ⇒ `auto`（默认档 ⇒ 不注入，行为可回滚）
 *  - 提示片段：三档各有稳定文案；`auto` 必须返回空串
 *  - 预留预算：与 `ai/clients/thinking.ts` 的 `EFFORT_TO_BUDGET` 同源
 *  - 接线：`MessageContextPipeline` 真的把片段注入了系统提示
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  DEFAULT_REPLY_EFFORT,
  REPLY_EFFORT_LEVELS,
  buildReplyEffortPrompt,
  isReplyEffortLevel,
  normalizeReplyEffort,
  resolveEffortThinkingBudget,
} from '../../src/chat/replyEffort';
import { EFFORT_TO_BUDGET } from '../../src/ai/clients/thinking';

const SRC = join(import.meta.dir, '..', '..', 'src');

describe('replyEffort：取值归一化', () => {
  it('合法取值原样返回（大小写/空白无关）', () => {
    for (const level of REPLY_EFFORT_LEVELS) {
      expect(isReplyEffortLevel(level)).toBe(true);
      expect(normalizeReplyEffort(level)).toBe(level);
    }
    expect(normalizeReplyEffort(' HIGH ')).toBe('high');
  });

  it('非法值与非字符串一律回落默认档 auto（不抛错）', () => {
    for (const invalid of ['xhigh', '', undefined, null, 1, {}]) {
      expect(isReplyEffortLevel(invalid)).toBe(false);
      expect(normalizeReplyEffort(invalid)).toBe(DEFAULT_REPLY_EFFORT);
    }
  });
});

describe('replyEffort：系统提示片段', () => {
  it('auto ⇒ 空串（不注入 ⇒ 行为与接线前一致）', () => {
    expect(buildReplyEffortPrompt('auto')).toBe('');
    expect(buildReplyEffortPrompt(undefined)).toBe('');
    expect(buildReplyEffortPrompt('nonsense')).toBe('');
  });

  it('三档各有稳定文案，且互不相同', () => {
    const low = buildReplyEffortPrompt('low');
    const medium = buildReplyEffortPrompt('medium');
    const high = buildReplyEffortPrompt('high');

    expect(low).toContain('精简');
    expect(medium).toContain('标准');
    expect(high).toContain('详尽');
    expect(new Set([low, medium, high]).size).toBe(3);
  });
});

describe('replyEffort：预留思考预算（第二步接线用）', () => {
  it('与 thinking.ts 的 EFFORT_TO_BUDGET 同源，auto ⇒ undefined', () => {
    expect(resolveEffortThinkingBudget('low')).toBe(EFFORT_TO_BUDGET.low);
    expect(resolveEffortThinkingBudget('medium')).toBe(EFFORT_TO_BUDGET.medium);
    expect(resolveEffortThinkingBudget('high')).toBe(EFFORT_TO_BUDGET.high);
    expect(resolveEffortThinkingBudget('auto')).toBeUndefined();
    expect(resolveEffortThinkingBudget(undefined)).toBeUndefined();
  });
});

describe('replyEffort：接线点（源码断言）', () => {
  it('MessageContextPipeline 读取 metadata.effortLevel 并注入 replyEffort 段', () => {
    const src = readFileSync(
      join(SRC, 'chat', 'services', 'MessageContextPipeline.ts'),
      'utf-8'
    );
    expect(src).toContain('buildReplyEffortPrompt');
    expect(src).toContain('metadata?.effortLevel');
    expect(src).toContain("'replyEffort'");
  });
});
