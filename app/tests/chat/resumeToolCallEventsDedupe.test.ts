/**
 * N-6（2026-11-06 真机）：续跑轮实时写 `assistant/tool_call` 事件后，落盘侧必须**只**过滤
 * tool_call 事件，不能把正文/思考事件一起过滤掉。
 *
 * 背景：续跑（批准后 `resumeStream`）原先只落最终 assistant 消息、不写任何事件 ⇒ 回放时
 * 工具结果没有 owner（前端只能显示「工具返回 #ID」）。修复后续跑在 `tool_start` 时实时写
 * `assistant/tool_call` 并给消息打 `metadata.__toolCallsWritten`，落盘时按该标记过滤重复。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLogStorage } from '../../src/session/storage/EventLogStorage.js';
import { ChatMessagePersistence } from '../../src/chat/manager/messagePersistence';
import type { Message } from '../../src/session/types/message';

const dir = mkdtempSync(join(tmpdir(), 'n6-resume-events-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** EventLogStorage.append 在会话目录不存在时跳过落盘 ⇒ 先建目录 */
function ensureSessionDir(sessionId: string): void {
  mkdirSync(join(dir, 'default', sessionId), { recursive: true });
}

function makePersistence(log: EventLogStorage): ChatMessagePersistence {
  return new ChatMessagePersistence({
    chatSessions: new Map(),
    sessionGateway: {} as never,
    getOrCreateEventLog: () => log,
    rebuildToolCallSeqMap: async () => {},
    toolCallSeqMap: new Map(),
    requestReconcile: () => {},
    pendingPersistPromises: new Set(),
    createAssistantMessage: () => ({}) as never,
    getStreamTailSeq: () => log.getTailSeq(),
  } as never);
}

function assistantWithToolCall(metadata: Record<string, unknown>): Message {
  return {
    id: 'msg-resume-1',
    role: 'assistant',
    sessionId: 'sess-n6',
    content: '检查完成',
    timestamp: Date.now(),
    metadata: {
      // convertMessage 从 metadata.tool_calls 生成 assistant/tool_call 事件（与生产一致）
      tool_calls: [
        {
          id: 'call_resume_1',
          type: 'function',
          function: {
            name: 'bash',
            arguments: '{"command":"node --check game.js"}',
          },
        },
      ],
      ...metadata,
    },
    blocks: [
      {
        id: 'b-text',
        type: 'text',
        content: '检查完成',
      },
      {
        id: 'b-call',
        type: 'tool_call',
        content: '',
        toolCall: {
          id: 'call_resume_1',
          name: 'bash',
          arguments: { command: 'node --check game.js' },
        },
      },
    ],
  } as unknown as Message;
}

async function readAll(log: EventLogStorage) {
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  let fromSeq = 1;
  for (;;) {
    const batch = await log.read({ fromSeq, limit: 1000 });
    if (batch.length === 0) break;
    events.push(
      ...batch.map((e) => ({
        type: e.type,
        data: e.data as Record<string, unknown>,
      }))
    );
    fromSeq = batch[batch.length - 1].seq + 1;
  }
  return events;
}

describe('N-6：续跑轮 tool_call 事件落盘去重', () => {
  it('已实时写过 tool_call ⇒ 落盘不再重复，但正文事件照常写', async () => {
    const log = new EventLogStorage('sess-n6-a', 'default', dir);
    ensureSessionDir('sess-n6-a');
    // 模拟续跑路径已实时写入的事件
    await log.append({
      type: 'assistant/tool_call',
      schemaVersion: 1,
      seq: 0,
      time: Date.now(),
      sessionId: 'sess-n6-a',
      data: {
        toolCallId: 'call_resume_1',
        name: 'bash',
        args: { command: 'node --check game.js' },
        messageId: 'msg-resume-1',
        callSeq: 0,
      },
    } as never);

    const persistence = makePersistence(log);
    await persistence.appendEventsForMessage(
      'sess-n6-a',
      assistantWithToolCall({ __toolCallsWritten: true })
    );

    const events = await readAll(log);
    const toolCalls = events.filter((e) => e.type === 'assistant/tool_call');
    const texts = events.filter(
      (e) => e.type === 'assistant/text' || e.type === 'assistant/text-batch'
    );
    expect(toolCalls).toHaveLength(1);
    expect(texts.length).toBeGreaterThan(0);
  });

  it('无标记（普通路径）⇒ tool_call 由落盘补齐（不能被误过滤）', async () => {
    const log = new EventLogStorage('sess-n6-b', 'default', dir);
    ensureSessionDir('sess-n6-b');
    const persistence = makePersistence(log);
    await persistence.appendEventsForMessage(
      'sess-n6-b',
      assistantWithToolCall({})
    );

    const events = await readAll(log);
    expect(events.some((e) => e.type === 'assistant/tool_call')).toBe(true);
  });
});
