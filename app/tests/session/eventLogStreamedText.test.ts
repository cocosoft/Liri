/**
 * N-59（2026-09-24）：落盘侧去重判据必须基于**事件层事实**，而非传递标记。
 *
 * 背景：助手正文有两条落盘通道 —— 流式 `assistant/text-batch`（缓冲聚合）与
 * `ChatManager._appendEventsForMessage` 经 `convertMessage` 派生的 `assistant/text`。
 * 去重此前**只认** `message.metadata.__streamedEventsWritten`，而实测落盘的 assistant 消息
 * **完全没有 metadata** ⇒ 两条通道都落 ⇒ 最小复现：「只回复两个字：收到」的落盘 content = **`收到收到`**。
 *
 * 「修复前必失败」：`hasStreamedTextForMessage` 在修复前不存在 ⇒ 本文件在修复前无法通过。
 */

import { describe, it, expect, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EventLogStorage } from '../../src/session/storage/EventLogStorage.js';

describe('N-59：正文已入流式通道的「事实」登记', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eventlog-n59-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('bufferTextChunk ⇒ hasStreamedTextForMessage 立即为 true（无需等 flush）', async () => {
    const log = new EventLogStorage('sess-n59', 'default', dir);
    expect(log.hasStreamedTextForMessage('msg-a')).toBe(false);
    await log.bufferTextChunk('msg-a', '收到');
    expect(log.hasStreamedTextForMessage('msg-a')).toBe(true);
    // 其它 messageId 不受影响（避免"整会话一刀切"式过滤）
    expect(log.hasStreamedTextForMessage('msg-b')).toBe(false);
  });

  it('空 content 不登记（与 bufferTextChunk 的 early-return 对齐）', async () => {
    const log = new EventLogStorage('sess-n59b', 'default', dir);
    await log.bufferTextChunk('msg-empty', '');
    expect(log.hasStreamedTextForMessage('msg-empty')).toBe(false);
  });
});
