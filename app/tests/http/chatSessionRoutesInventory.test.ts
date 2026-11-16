// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// chat-session 路由清单守卫（P3-2，2026-11-16）
//
// `dispatchChatSessionRoutes` 是「顺序即语义」的路由表：`/v1/sessions/messages/search` 必须先于
// `/v1/sessions/:id/messages`，泛型 `([^/]+)$` 必须在各子路径路由之后（BUG-4 的根因）。
// 写反不会编译失败，只会静默错配。本表钉住各分段的相对顺序与「每个 handler 只调用一次」。
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const ROUTES = readFileSync(
  new URL(
    '../../src/infrastructure/http/handlers/routes/chat-session-routes.ts',
    import.meta.url
  ),
  'utf8'
);

const at = (handler: string) => ROUTES.indexOf(`await ${handler}(`);
const countCalls = (handler: string) =>
  ROUTES.split(`await ${handler}(`).length - 1;

/** 各分段内的 handler（文件内顺序；基础 CRUD 分发器定义在最前） */
const GROUPS: ReadonlyArray<readonly string[]> = [
  ['handleListSessions', 'handleCreateSession', 'handleGetCurrentSession'],
  ['handleChatCompletions', 'handleQuestionAnswer'],
  [
    'handleRecoverStaleSession',
    'handleSearchMessagesFTS',
    'handleGetSessionTimeline',
    'handleGetSessionMessages',
    'handleGetSessionRoundSummaries',
    'handleAddSessionMessage',
    'handleDeleteMessage',
    'handleTruncateMessages',
    'handleUpdateMessageBlocks',
    'handleSessionStreamingStatus',
  ],
  [
    'handleLatestCheckpoint',
    'handleSaveLatestCheckpoint',
    'handleDeleteLatestCheckpoint',
    'handleResumeChat',
    'handleContinueSession',
  ],
  [
    'handleGetSession',
    'handleSwitchSession',
    'handleRenameSession',
    'handleGenerateTitle',
    'handleUpdateSessionMeta',
    'handleCompactSession',
    'handleBatchDeleteSessions',
    'handlePruneSession',
  ],
  [
    'handleGetSessionMemory',
    'handleExportSessionEvents',
    'handleGetSessionEvents',
    'handleGetSessionStats',
    'handleForkSession',
    'handleDeleteSession',
    'handleClearAllSessions',
  ],
  ['handleSteerSession'],
];

describe('chat-session 路由清单', () => {
  it('每个 handler 恰好调用一次（漏项 = 路由丢失）', () => {
    for (const group of GROUPS) {
      for (const handler of group) {
        expect(countCalls(handler)).toBe(1);
      }
    }
  });

  it('分段顺序：基础 → Chat → 消息 → 检查点/续跑 → 生命周期 → 可观测 → 转向', () => {
    for (let g = 1; g < GROUPS.length; g++) {
      const prevMax = Math.max(...GROUPS[g - 1]!.map(at));
      const currMin = Math.min(...GROUPS[g]!.map(at));
      expect(prevMax).toBeGreaterThan(-1);
      expect(prevMax).toBeLessThan(currMin);
    }
  });

  it('组内顺序与匹配顺序一致', () => {
    for (const group of GROUPS) {
      const positions = group.map(at);
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]!).toBeGreaterThan(positions[i - 1]!);
      }
    }
  });

  it('全文搜索先于通用消息路由（否则 search 被当成 sessionId）', () => {
    const search = ROUTES.indexOf("url === '/v1/sessions/messages/search'");
    const messages = ROUTES.indexOf('/^\\/v1\\/sessions\\/(.+)\\/messages$/');
    expect(search).toBeGreaterThan(-1);
    expect(messages).toBeGreaterThan(-1);
    expect(search).toBeLessThan(messages);
  });

  it('泛型 GET :id 使用单段匹配（BUG-4：不得贪婪吞子路径）', () => {
    expect(ROUTES).toContain('/^\\/v1\\/sessions\\/([^/]+)$/');
  });

  it('分发函数以 return false 兜底（未匹配不得吞请求）', () => {
    expect(ROUTES.trimEnd().endsWith('return false;\n}')).toBe(true);
  });
});
