/**
 * ③（2026-10-16）：**流式链路斜杠命令短路**（`ChatOrchestrator.streamMessage`）。
 *
 * 背景：此前只有**非流式** `sendMessage` 派发命令（`_handleCommand`），而客户端聊天
 * （`chatService` 恒 `stream:true`）与渠道（2026-08-20 流式并轨）都走流式入口 ⇒ 聊天里打
 * `/budget status` 会被当普通消息送进模型（真机实测：模型自述「该斜杠命令由应用层处理
 * …当前消息落到了我这里」）。本片把流式入口改成与非流式**同一判据 + 同一实现**。
 *
 * 三例的分工：① 正向（真跑注册表执行且落盘）② 未知名如实回报 ③ **反证**：普通消息不得被
 * 短路吞掉（否则等于把聊天内容当命令）。
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { initializeCommands } from '@modules/commands';
import type { Message } from '@modules/session/types/message.js';
import { ChatOrchestrator } from '../../../src/chat/orchestrator/ChatOrchestrator.js';
import { createTestHost, createTestSession } from './helpers.js';

const SESSION_ID = 'cmd-short-circuit';

/** 流式 chunk 的最小断言面 */
interface TestChunk {
  type?: string;
  content?: string;
  sessionId?: string;
}

/** 建最小可用 orchestrator：命令分支只需要 sessionLifecycle / messageService / addAndPersistMessage */
function buildOrchestrator(
  overrides: Parameters<typeof createTestHost>[0] = {}
): { orch: ChatOrchestrator; persisted: Message[] } {
  const session = createTestSession({ id: SESSION_ID });
  const persisted: Message[] = [];
  const host = createTestHost({
    session,
    sessionLifecycle: {
      getOrLoadSession: async () => session,
    } as never,
    messageService: {
      createAssistantMessage: (
        content: string,
        opts?: { sessionId?: string; metadata?: Record<string, unknown> }
      ) =>
        ({
          id: 'm-command',
          role: 'assistant',
          content,
          sessionId: opts?.sessionId,
          metadata: opts?.metadata,
        }) as unknown as Message,
      createToolResultMessage: () => ({}) as Message,
    } as never,
    addAndPersistMessage: (_sid: string, msg: Message) => {
      persisted.push(msg);
    },
    ...overrides,
  });
  return { orch: new ChatOrchestrator({ host }), persisted };
}

/** 消费整条流：返回 chunk 列表与终值消息 */
async function consume(gen: {
  next: () => Promise<IteratorResult<unknown, Message>>;
}): Promise<{ chunks: TestChunk[]; message?: Message }> {
  const chunks: TestChunk[] = [];
  for (;;) {
    const r = await gen.next();
    if (r.done) return { chunks, message: r.value };
    chunks.push(r.value as TestChunk);
  }
}

describe('③ ChatOrchestrator.streamMessage — 斜杠命令短路', () => {
  beforeAll(async () => {
    await initializeCommands();
  });

  it('`/budget status` ⇒ 首个 chunk 即命令输出，且落盘为 assistant 消息（与非流式同源）', async () => {
    const { orch, persisted } = buildOrchestrator();

    const { chunks, message } = await consume(
      orch.streamMessage('/budget status', { sessionId: SESSION_ID })
    );

    expect(chunks.length).toBe(1);
    expect(chunks[0]?.type).toBe('text');
    expect(chunks[0]?.content).toContain('每日预算限额');
    // sessionId 必填：前端靠它归位到会话
    expect(chunks[0]?.sessionId).toBe(SESSION_ID);
    expect(message?.content).toContain('每日预算限额');
    // 与非流式同一实现 ⇒ 命令输出入会话历史（流式短路不得只回显不落盘）
    expect(persisted.length).toBe(1);
  });

  it('未注册命令 ⇒ 短路并如实回报（`Command not found`，不进模型）', async () => {
    const { orch } = buildOrchestrator();

    const { chunks } = await consume(
      orch.streamMessage('/definitely-not-a-command', { sessionId: SESSION_ID })
    );

    expect(chunks.length).toBe(1);
    expect(chunks[0]?.content).toContain('Command not found');
    expect(chunks[0]?.content).toContain('definitely-not-a-command');
  });

  it('反证：普通消息**不**短路 —— 仍走 streamMessageFlow 拿模型文本', async () => {
    const { orch } = buildOrchestrator({
      llmChunks: [{ content: 'hello from model' }],
    });

    const { chunks } = await consume(
      orch.streamMessage('你好', { sessionId: SESSION_ID })
    );

    const text = chunks
      .filter((c) => c.type === 'text')
      .map((c) => c.content ?? '')
      .join('');
    expect(text).toContain('hello from model');
    expect(text).not.toContain('每日预算限额');
  });
});
