// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P1 收口（2026-11-05）：**流式主路径**按会话 `chatMode` 裁剪工具集。
 *
 * 缺口背景：`chatModePolicy` 的映射与过滤当时只接在非流式
 * `ChatOrchestrator.sendMessage`，而桌面端走的是流式
 * （`ChatManager` → `ChatOrchestrator.streamMessage` → `runStreamMessage`）
 * ⇒ `creative` 的"去终端工具"在生产链路里不生效。本文件用**真实执行**钉住：
 *   ① `buildToolDefinitions` 收到的是**过滤后**清单；
 *   ② `recordToolsSnapshot` 落的也是过滤后清单（「模型可见 ⇔ 已落盘」）。
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createTestHost, createTestSession } from './helpers';
import { runStreamMessage } from '../../../src/chat/orchestrator/streamMessageFlow.js';

/** 注册表里的工具集：3 个执行类 + 2 个读写类 */
const SCHEMAS = [
  { name: 'bash' },
  { name: 'powershell' },
  { name: 'code_run' },
  { name: 'file_read' },
  { name: 'file_write' },
];

interface Captured {
  built: string[];
  snapshot: string[];
}

function hostWithMode(chatMode?: string): {
  host: ReturnType<typeof createTestHost>;
  captured: Captured;
} {
  const captured: Captured = { built: [], snapshot: [] };
  const metadata: Record<string, unknown> = { title: 'test-session' };
  if (chatMode) metadata['chatMode'] = chatMode;
  const session = createTestSession({
    metadata: metadata as unknown as ReturnType<
      typeof createTestSession
    >['metadata'],
  });
  const host = createTestHost({
    session,
    llmChunks: [{ content: 'ok' }],
    getToolRegistry: () =>
      ({ getToolSchemas: () => SCHEMAS }) as unknown as ReturnType<
        ReturnType<typeof createTestHost>['getToolRegistry']
      >,
    buildToolDefinitions: (schemas: unknown[]) => {
      captured.built = (schemas as { name: string }[]).map((s) => s.name);
      return schemas as never;
    },
    recordToolsSnapshot: (_sid: string, schemas: unknown[]) => {
      captured.snapshot = (schemas as { name: string }[]).map((s) => s.name);
    },
  } as never);
  return { host, captured };
}

async function drain(host: ReturnType<typeof createTestHost>): Promise<void> {
  for await (const _chunk of runStreamMessage(host, '测试', {})) {
    // 只关心工具集构建，不关心正文 chunk
  }
}

describe('流式路径：chatMode 裁剪工具集', () => {
  it('creative ⇒ 构建与快照都不含 bash / powershell / code_run', async () => {
    const { host, captured } = hostWithMode('creative');
    await drain(host);

    expect(captured.built).toEqual(['file_read', 'file_write']);
    // 模型可见 ⇔ 已落盘：快照必须是过滤后的同一份
    expect(captured.snapshot).toEqual(['file_read', 'file_write']);
  });

  it('auto ⇒ 全量下发（零行为变更）', async () => {
    const { host, captured } = hostWithMode('auto');
    await drain(host);

    expect(captured.built).toEqual(SCHEMAS.map((s) => s.name));
    expect(captured.snapshot).toEqual(SCHEMAS.map((s) => s.name));
  });

  it('chatMode 缺失 ⇒ 按 auto 全量（历史会话不变）', async () => {
    const { host, captured } = hostWithMode(undefined);
    await drain(host);

    expect(captured.built).toEqual(SCHEMAS.map((s) => s.name));
  });

  it('脏值 ⇒ 按 auto 处理（不放宽也不误删）', async () => {
    const { host, captured } = hostWithMode('CREATIVE-typo');
    await drain(host);

    expect(captured.built).toEqual(SCHEMAS.map((s) => s.name));
  });
});

describe('续跑路径：同一口径（源断言）', () => {
  const RESUME_SRC = readFileSync(
    new URL('../../../src/chat/manager/streamResume.ts', import.meta.url),
    'utf8'
  );

  it('toolSchemas 经同一过滤函数，快照落过滤后清单', () => {
    expect(RESUME_SRC).toContain(
      'filterToolSchemasByChatMode(allSchemas, chatModePolicy)'
    );
    expect(RESUME_SRC).toContain('recordToolsSnapshot(sessionId, toolSchemas)');
    // 不得把未过滤的 allSchemas 落快照（违反「模型可见 ⇔ 已落盘」）
    expect(RESUME_SRC).not.toContain(
      'recordToolsSnapshot(sessionId, allSchemas)'
    );
  });
});
