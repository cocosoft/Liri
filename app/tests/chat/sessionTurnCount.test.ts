// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P2-2（2026-11-28，真机 `session_mwz477wj251057474e`）：`sessionContext` 注入的"轮数"
 * 必须是**用户轮次**，不得用 `messages.length`（含 assistant/tool 等内部消息）。
 *
 * 该真机第 8 轮注入「当前会话已进行 69 轮」（真实用户轮次 8），模型据此误判会话规模。
 */
import { describe, expect, it } from 'bun:test';

import { countSessionTurns } from '../../src/chat/services/context/systemPromptAssembly';

describe('countSessionTurns · 会话轮数口径', () => {
  it('只数 user 消息（内部 assistant/tool 消息不计）', () => {
    const messages = [
      { role: 'user' },
      { role: 'assistant' },
      { role: 'tool' },
      { role: 'user' },
      ...Array.from({ length: 65 }, () => ({ role: 'assistant' })),
    ];
    expect(countSessionTurns(messages)).toBe(2);
  });

  it('空数组 / 无 user / 缺 role ⇒ 0', () => {
    expect(countSessionTurns([])).toBe(0);
    expect(countSessionTurns([{ role: 'assistant' }, { role: 'tool' }])).toBe(
      0
    );
    expect(countSessionTurns([{}])).toBe(0);
  });
});
