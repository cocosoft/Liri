/**
 * A2A 委派后端（CoreAPI 对话轮，方案①）单元守卫（2026-09-29）。
 *
 * 该后端由 `getLocalHTTPService()` **同步装配**（见 `LocalHTTPService`），端点行为已在
 * `tests/http/a2aRoutes.test.ts` 以**注入假后端**覆盖；本文件补"后端自身"的三条：
 *   ① 每次委派**新建会话**（`mode: 'a2a'`），并把 `sessionId` 透传给对话轮；
 *   ② 未给 `agentId` ⇒ **不带** `systemPrompt`（不臆造人格）；
 *   ③ `agentId` **未命中**注册表 ⇒ 如实降级（**仍不带** `systemPrompt`），不抛错、正常返回正文。
 *
 * 通过**窄端口注入**（`A2ADelegationCore`）测试，不触碰真实 `CoreAPI` / 不产生真实对话成本。
 */
import { describe, expect, it } from 'bun:test';
import {
  createCoreApiDelegator,
  type A2ADelegationCore,
} from '../../src/infrastructure/http/handlers/routes/a2a-delegator';

interface Recorded {
  sessions: { title?: string; mode?: string; metadata?: unknown }[];
  chats: {
    content: string;
    sessionId?: string;
    stream?: boolean;
    systemPrompt?: string;
  }[];
}

function makeCore(): { core: A2ADelegationCore; rec: Recorded } {
  const rec: Recorded = { sessions: [], chats: [] };
  let seq = 0;
  const core: A2ADelegationCore = {
    async createSession(params) {
      rec.sessions.push(params ?? {});
      seq += 1;
      return { id: `sess-${seq}` };
    },
    async chat(request) {
      rec.chats.push(request);
      return { content: 'reply-text' };
    },
  };
  return { core, rec };
}

describe('A2A 委派后端（CoreAPI 对话轮）', () => {
  it('① 新建会话（mode="a2a"）并把 sessionId 透传给对话轮', async () => {
    const { core, rec } = makeCore();
    const delegate = createCoreApiDelegator(core);

    const reply = await delegate('hello-world');

    expect(reply).toBe('reply-text');
    expect(rec.sessions).toHaveLength(1);
    expect(rec.sessions[0]?.mode).toBe('a2a');
    expect(rec.chats).toHaveLength(1);
    expect(rec.chats[0]).toMatchObject({
      content: 'hello-world',
      sessionId: 'sess-1',
      stream: false,
    });
  });

  it('② 未给 agentId ⇒ 不带 systemPrompt（不臆造人格）', async () => {
    const { core, rec } = makeCore();
    const delegate = createCoreApiDelegator(core);

    await delegate('hi');

    expect('systemPrompt' in (rec.chats[0] ?? {})).toBe(false);
    expect(rec.sessions[0]?.title).toBe('A2A 委派');
  });

  it('③ agentId 未命中注册表 ⇒ 如实降级（不带 systemPrompt）且正常返回正文', async () => {
    const { core, rec } = makeCore();
    const delegate = createCoreApiDelegator(core);

    const reply = await delegate('hi', '__no_such_agent__');

    expect(reply).toBe('reply-text');
    expect('systemPrompt' in (rec.chats[0] ?? {})).toBe(false);
    expect(rec.sessions[0]?.title).toContain('__no_such_agent__');
  });

  it('④ 正文为空/未定义 ⇒ 返回空串（不产生 "undefined" 文本）', async () => {
    const core: A2ADelegationCore = {
      async createSession() {
        return { id: 'sess-x' };
      },
      async chat() {
        return { content: '' };
      },
    };
    expect(await createCoreApiDelegator(core)('hi')).toBe('');
  });
});
