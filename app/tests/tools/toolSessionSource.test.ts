/**
 * 工具侧会话消息读取源（2026-10-23）
 *
 * 背景：`BriefTool` / `SaveConversationTool` 原先把旧服务 `chatService.getSessionMessages`
 * 当数据源 —— 那是 `chat_sessions/*.json` 的历史目录，**无写入方**、也不带归属信息
 * ⇒ 工具永远拿到空数组，且是一条绕过身份分区的旁路。
 *
 * 现在两者都走 `sessionMessageSource`（缺省经 CoreAPI 的身份作用域读取）。
 * 本用例锁四件事：
 *  ① CoreAPI 消息 → `SessionMessage` 形状（`timestamp` 还原成 `createdAt`）；
 *  ② 空集合 ⇒ 空数组（"无权限"与"不存在"同表现）；
 *  ③ `content` 非字符串时不丢内容；
 *  ④ 两个工具的接线（导入新入口、不再导入旧 `@modules/chat`）。
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import {
  loadSessionMessages,
  toSessionMessages,
} from '../../src/tools/sessionMessageSource';

describe('工具侧会话消息读取源', () => {
  it('CoreAPI 消息映射为 SessionMessage 形状（role / timestamp）', async () => {
    const messages = await loadSessionMessages('s-1', async () => ({
      messages: [
        {
          id: 'm-1',
          role: 'assistant',
          content: '决定：采用方案 B',
          timestamp: 1700000000000,
        },
      ],
    }));

    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('assistant');
    expect(messages[0].content).toBe('决定：采用方案 B');
    expect(messages[0].createdAt).toBeInstanceOf(Date);
    expect((messages[0].createdAt as Date).getTime()).toBe(1700000000000);
  });

  it('空集合 ⇒ 空数组（无权限 / 不存在同一表现）', async () => {
    const messages = await loadSessionMessages('s-x', async () => ({
      messages: [],
    }));

    expect(messages).toEqual([]);
  });

  it('content 非字符串 ⇒ 序列化，不丢内容', () => {
    const mapped = toSessionMessages([
      {
        id: 'm-2',
        role: 'user',
        content: [{ type: 'text', text: 'hi' }] as unknown as string,
        timestamp: 1,
      },
    ]);

    expect(mapped[0].content).toContain('"text":"hi"');
  });

  it('两个工具的接线：只用 sessionMessageSource，不再读旧 chatService', () => {
    const read = (rel: string): string =>
      readFileSync(resolve(__dirname, rel), 'utf-8');

    for (const rel of [
      '../../src/tools/BriefTool/BriefTool.ts',
      '../../src/tools/SaveConversationTool/SaveConversationTool.ts',
    ]) {
      const source = read(rel);
      expect(source).toContain("from '../sessionMessageSource'");
      expect(source).not.toContain("from '@modules/chat'");
    }
  });
});
