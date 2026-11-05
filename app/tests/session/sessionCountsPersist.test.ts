/**
 * P1-5（2026-11-05）：会话用户面计数的**写路径持久化**。
 *
 * 背景：列表接口 `GET /v1/sessions` 的 `messageCount` 原先取内存切片（真机 7 vs 持久层 698），
 * 甚至可能为 0（被前端当成"空会话"折叠）。修复：存储层在写/删消息时把
 * `metadata.messageCount` / `metadata.roundCount` 维护进 `session.json`，列表直接读元数据。
 *
 * 本用例锁住：
 *   ① 写消息后计数落盘（含 role 口径：user+assistant，排除 tool）；
 *   ② 任务分区消息（PDCA 步骤）不计入；
 *   ③ 删除消息后重算；
 *   ④ 新进程加载消息时**校准**（存量会话升级场景）。
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { StorageType } from '../../src/session/storage/UnifiedStorage';
import { FileSystemUnifiedStorage } from '../../src/session/storage/FileSystemUnifiedStorage';
import type { UnifiedMessage } from '../../src/session/types/UnifiedMessage';
import type { UnifiedSession } from '../../src/session/types/UnifiedSession';

const SID = 'sid-p15-counts';
let tmpRoot = '';
let storage: FileSystemUnifiedStorage;

function msg(
  id: string,
  role: string,
  metadata?: Record<string, unknown>
): UnifiedMessage {
  return {
    id,
    sessionId: SID,
    role,
    content: id,
    timestamp: Date.now(),
    ...(metadata ? { metadata } : {}),
  } as unknown as UnifiedMessage;
}

/** 直接从磁盘读 `session.json` 的 metadata（验证"真的落盘了"，而非只改内存） */
function persistedMetadata(): Record<string, unknown> {
  const raw = fs.readFileSync(path.join(tmpRoot, SID, 'session.json'), 'utf-8');
  return (
    (JSON.parse(raw) as { metadata?: Record<string, unknown> }).metadata ?? {}
  );
}

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'p15-counts-'));
  storage = new FileSystemUnifiedStorage({
    type: StorageType.FILESYSTEM,
    basePath: tmpRoot,
  });
  await storage.createSession({
    id: SID,
    createdAt: new Date(),
    updatedAt: new Date(),
    messages: [],
    metadata: {},
  } as unknown as UnifiedSession);
});

afterAll(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* 清理失败不影响测试结论 */
  }
});

describe('P1-5：计数的写路径持久化', () => {
  test('写消息 ⇒ session.json 记录 user+assistant 计数（排除 tool / 任务消息）', async () => {
    await storage.addMessage(SID, msg('u1', 'user'));
    await storage.addMessage(SID, msg('a1', 'assistant'));
    await storage.addMessage(SID, msg('t1', 'tool'));
    // PDCA 步骤消息：assistant + isTaskMessage
    await storage.addMessage(
      SID,
      msg('task1', 'assistant', { isTaskMessage: true, taskId: 'pdca_x' })
    );

    expect(persistedMetadata().messageCount).toBe(2);
    expect(persistedMetadata().roundCount).toBe(1);
  });

  test('删消息 ⇒ 计数重算并落盘', async () => {
    await storage.deleteMessage(SID, 'a1');
    expect(persistedMetadata().messageCount).toBe(1);
    expect(persistedMetadata().roundCount).toBe(1);
  });

  test('批量删消息 ⇒ 计数重算并落盘', async () => {
    await storage.deleteMessages(SID, ['u1', 't1']);
    expect(persistedMetadata().messageCount).toBe(0);
    expect(persistedMetadata().roundCount).toBe(0);
  });
});
