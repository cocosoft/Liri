// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 2026-11-11：历史消息的**读时覆盖**（`applyMessageOverrides`）。
 *
 * 背景：`getSessionMessages` 以事件派生为主源，投影改写不可见；清理重复收尾提示时
 * 需要按消息覆盖正文、隐藏指定块，且不影响其他消息与入参。
 *
 * 体积约束：覆盖只存「正文 + 隐藏块 id」；存整份 blocks 会让 session.json 从 KB 级
 * 膨胀到百 KB（真机 199KB）。旧版 `blocks` 覆盖仍兼容读取。
 */
import { describe, expect, it } from 'bun:test';
import { applyMessageOverrides } from '@openliri/service/runtime/api/messageOverrides';

const base = () => [
  {
    id: 'a',
    role: 'assistant',
    content: '旧文案',
    blocks: [
      { id: 'blk_text', type: 'text' },
      { id: 'blk_tool', type: 'tool_call' },
    ],
  },
  { id: 'b', role: 'user', content: '提问', blocks: [] },
];

describe('applyMessageOverrides', () => {
  it('无覆盖表 ⇒ 原样返回同一引用', () => {
    const messages = base();
    expect(applyMessageOverrides(messages, undefined)).toBe(messages);
    expect(applyMessageOverrides(messages, {})).toBe(messages);
  });

  it('按 hiddenBlockIds 隐藏指定块，其余块与未命中消息保持不变', () => {
    const messages = base();
    const out = applyMessageOverrides(messages, {
      a: { content: '', hiddenBlockIds: ['blk_text'] },
    });
    expect(out[0].content).toBe('');
    expect(out[0].blocks).toEqual([{ id: 'blk_tool', type: 'tool_call' }]);
    expect(out[1]).toBe(messages[1]);
    // 入参不被修改
    expect(messages[0].content).toBe('旧文案');
    expect(messages[0].blocks).toHaveLength(2);
  });

  it('只给 content / 只给 hiddenBlockIds 时互不影响', () => {
    const messages = base();
    const onlyText = applyMessageOverrides(messages, {
      a: { content: '新文案' },
    });
    expect(onlyText[0].content).toBe('新文案');
    expect(onlyText[0].blocks).toHaveLength(2);

    const onlyHidden = applyMessageOverrides(messages, {
      a: { hiddenBlockIds: ['blk_tool'] },
    });
    expect(onlyHidden[0].content).toBe('旧文案');
    expect(onlyHidden[0].blocks).toEqual([{ id: 'blk_text', type: 'text' }]);
  });

  it('存量整份 blocks 覆盖仍兼容（旧数据不失效）', () => {
    const messages = base();
    const out = applyMessageOverrides(messages, {
      a: { content: '', blocks: [{ id: 'blk_tool', type: 'tool_call' }] },
    });
    expect(out[0].content).toBe('');
    expect(out[0].blocks).toEqual([{ id: 'blk_tool', type: 'tool_call' }]);
  });
});
