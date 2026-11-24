/**
 * P2-2（2026-11-25）「记忆用途」单测。
 *
 * 规格：`.trae/specs/agent-memory-optimization.md` §4 P2-2
 * 覆盖：会话级用途优先并去空白 · 空用途零注入 · 只给软引导（不预设硬过滤规则）。
 */
import { describe, expect, it } from 'bun:test';
import {
  buildMemoryPurposeSection,
  resolveMemoryPurpose,
} from '@modules/chat/services/context/sessionMemoryInjection';

describe('记忆用途（P2-2）', () => {
  it('会话级用途优先（去首尾空白）', () => {
    expect(resolveMemoryPurpose({ memoryPurpose: '  research  ' })).toBe(
      'research'
    );
  });

  it('空用途 ⇒ 空段（零注入）', () => {
    expect(buildMemoryPurposeSection('')).toBe('');
    expect(buildMemoryPurposeSection('   ')).toBe('');
  });

  it('非空用途 ⇒ 段落含用途，且只给软引导（无硬过滤规则）', () => {
    const section = buildMemoryPurposeSection('coding');
    expect(section).toContain('## 记忆用途');
    expect(section).toContain('coding');
    expect(section).toContain('长期事实、规则与陷阱');
    // A5：不预设"只记失败"之类硬规则
    expect(section).not.toContain('只记失败');
  });
});
