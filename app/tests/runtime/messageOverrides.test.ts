// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 2026-11-11：历史消息的**读时覆盖**（`applyMessageOverrides`）。
 *
 * 背景：`getSessionMessages` 以事件派生为主源，投影改写不可见；清理重复收尾提示时
 * 需要按消息覆盖 `content` / `blocks`，且不影响其他消息与入参。
 */
import { describe, expect, it } from 'bun:test';
import { applyMessageOverrides } from '@openliri/service/runtime/api/messageOverrides';

const base = () => [
  { id: 'a', role: 'assistant', content: '旧文案', blocks: [{ type: 'text' }] },
  { id: 'b', role: 'user', content: '提问', blocks: [] },
];

describe('applyMessageOverrides', () => {
  it('无覆盖表 ⇒ 原样返回同一引用', () => {
    const messages = base();
    expect(applyMessageOverrides(messages, undefined)).toBe(messages);
    expect(applyMessageOverrides(messages, {})).toBe(messages);
  });

  it('按 id 覆盖 content / blocks，未命中消息保持不变', () => {
    const messages = base();
    const out = applyMessageOverrides(messages, {
      a: { content: '', blocks: [{ type: 'tool_call' }] },
    });
    expect(out[0].content).toBe('');
    expect(out[0].blocks).toEqual([{ type: 'tool_call' }]);
    expect(out[1]).toBe(messages[1]);
    // 入参不被修改
    expect(messages[0].content).toBe('旧文案');
  });

  it('只覆盖显式字段（仅 content 或仅 blocks）', () => {
    const messages = base();
    const onlyText = applyMessageOverrides(messages, {
      a: { content: '新文案' },
    });
    expect(onlyText[0].content).toBe('新文案');
    expect(onlyText[0].blocks).toEqual([{ type: 'text' }]);

    const onlyBlocks = applyMessageOverrides(messages, {
      a: { blocks: [{ type: 'tool_call' }] },
    });
    expect(onlyBlocks[0].content).toBe('旧文案');
  });
});
