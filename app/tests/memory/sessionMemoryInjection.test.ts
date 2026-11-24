/**
 * P0-1（2026-11-25）会话记忆注入预算单测。
 *
 * 规格：`.trae/specs/agent-memory-optimization.md` §4 P0-1
 * 覆盖：预算内原文注入 · 超预算降级为索引（不含正文）+ 分组计数 + 召回提示。
 */
import { describe, expect, it } from 'bun:test';
import {
  buildSessionMemoryInjection,
  type SessionMemorySource,
} from '@modules/chat/services/context/sessionMemoryInjection';

function source(
  fullText: string,
  items: Array<{ type: string; content: string }>
): SessionMemorySource {
  return {
    getMemoryContext: () => fullText,
    loadMemory: () => ({ items }),
  };
}

describe('buildSessionMemoryInjection', () => {
  it('无记忆 ⇒ 空 text（零注入）', () => {
    const result = buildSessionMemoryInjection(source('', []), 's1', 100);
    expect(result.text).toBe('');
    expect(result.mode).toBe('full');
  });

  it('预算内 ⇒ 原文注入', () => {
    const full = '## 会话历史记忆\n\n### 已做决策\n- 使用方案 A';
    const result = buildSessionMemoryInjection(
      source(full, [{ type: 'decision', content: '使用方案 A' }]),
      's1',
      10_000
    );

    expect(result.mode).toBe('full');
    expect(result.text).toBe(full);
  });

  it('超预算 ⇒ 降级为索引（计数 + 召回提示，不含正文）', () => {
    const longBody = `- ${'很长的流水账内容'.repeat(200)}`;
    const full = `## 会话历史记忆\n\n### 待办事项\n${longBody}`;
    const result = buildSessionMemoryInjection(
      source(full, [
        { type: 'decision', content: '决策一' },
        { type: 'decision', content: '决策二' },
        { type: 'file_change', content: '改了 a.ts' },
      ]),
      's1',
      20
    );

    expect(result.mode).toBe('index');
    expect(result.itemCount).toBe(3);
    expect(result.text).toContain('超出注入预算');
    expect(result.text).toContain('决策记录：2 条');
    expect(result.text).toContain('文件变更：1 条');
    expect(result.text).toContain('recall_memory');
    // 不截断正文，也不搬运正文
    expect(result.text).not.toContain('很长的流水账内容');
  });
});
