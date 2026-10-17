// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 系统提示**最终拼装**单测（2026-10-17）
 *
 * 背景：流式（`StreamPipeline`）与非流式（`sendMessageFlow`）原先各写一遍
 * 「基础 + 用户自定义」的拼接；接「运行时补充」时若再抄一遍会漂移（CS01）。
 * 本文件钉住三条路径共用同一个纯函数，且顺序固定：
 *   基础 → `## 用户自定义系统提示` → 运行时补充（通道投递契约）。
 */

import { describe, it, expect } from 'bun:test';
import { composeSystemPrompt } from '../../src/chat/services/systemPromptComposition';

describe('composeSystemPrompt：顺序与空值语义', () => {
  it('只有基础提示 ⇒ 原样返回（零回归）', () => {
    expect(composeSystemPrompt({ assembled: 'BASE' })).toBe('BASE');
  });

  it('空字符串的自定义提示 / 运行时补充 ⇒ 视为未提供（不产出空段）', () => {
    expect(
      composeSystemPrompt({
        assembled: 'BASE',
        customPrompt: '',
        runtimeNote: '',
      })
    ).toBe('BASE');
  });

  it('自定义提示带固定小标题', () => {
    expect(
      composeSystemPrompt({ assembled: 'BASE', customPrompt: 'CUSTOM' })
    ).toBe('BASE\n\n## 用户自定义系统提示\nCUSTOM');
  });

  it('运行时补充**追加在最后**（通道契约必须在末尾，不能被自定义提示覆盖）', () => {
    expect(
      composeSystemPrompt({
        assembled: 'BASE',
        customPrompt: 'CUSTOM',
        runtimeNote: 'NOTE',
      })
    ).toBe('BASE\n\n## 用户自定义系统提示\nCUSTOM\n\nNOTE');
  });

  it('仅运行时补充（无自定义提示）⇒ 直接接在基础提示后', () => {
    expect(
      composeSystemPrompt({ assembled: 'BASE', runtimeNote: 'NOTE' })
    ).toBe('BASE\n\nNOTE');
  });
});
