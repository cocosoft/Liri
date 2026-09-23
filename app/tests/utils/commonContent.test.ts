// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 正文完整性选取规则（2026-09-22 根因修复守门用例）
// 规则实现：`src/utils/common.ts` → `pickMoreCompleteContent`
// 证据：会话 `session_mub9t9o0h7x2i9ac6rj` 第 906 条 assistant 记录 content=120 字符、
//      同条 blocks 正文=2758 字符 ⇒ 旧判据"非空即采用"让短桩覆盖正文。

import { describe, expect, it } from 'bun:test';
import { pickMoreCompleteContent } from '../../src/utils/common';

const STUB = '## 复审结论（v1.4）\n'; // 流式前导短桩
const FULL = '## 复审结论（v1.4）\n\n第一段完整正文……（2758 字符的量级）';

describe('pickMoreCompleteContent', () => {
  it('备来源更长 ⇒ 取备来源（修复前"非空即采用"会返回短桩）', () => {
    expect(pickMoreCompleteContent(STUB, FULL)).toBe(FULL);
  });

  it('主来源更长 ⇒ 保持主来源（不误伤正常路径）', () => {
    expect(pickMoreCompleteContent(FULL, STUB)).toBe(FULL);
  });

  it('主来源为空/纯空白、备来源有内容 ⇒ 取备来源（保持旧行为）', () => {
    expect(pickMoreCompleteContent('', FULL)).toBe(FULL);
    expect(pickMoreCompleteContent('   \n', FULL)).toBe(FULL);
  });

  it('两者皆空/皆纯空白 ⇒ 返回空串', () => {
    expect(pickMoreCompleteContent('', '')).toBe('');
    expect(pickMoreCompleteContent('  ', '\n')).toBe('\n');
  });

  it('主来源保留原始形态（不做 trim）', () => {
    const raw = '  有缩进的正文  ';
    expect(pickMoreCompleteContent(raw, '短')).toBe(raw);
  });
});
