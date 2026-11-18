/**
 * 特征化测试：`ChatStreamSetup.prepare` 的既有行为（P3-2 拆分前置）。
 *
 * 目的：在把「输入净化/敏感校验」「外部 signal 中继」「pre-message hook 改写」
 * 「轮次记账」四段原样外移为私有方法之前，先用测试锁住可观测结果
 * （出参、依赖调用、Abort 语义、消息落盘与 content 改写）。
 */
import { describe, expect, it } from 'bun:test';
import { AppError, ErrorCategory } from '@openliri/infra/error';
import { ChatStreamSetup } from '../../src/chat/manager/streamSetup';
import type { StreamSetupDeps } from '../../src/chat/manager/streamSetup';
import type { ChatSession } from '@modules/session/types/session.js';
import type { Message } from '@modules/session/types/message.js';

type Mutex = ReturnType<StreamSetupDeps['getOrCreateMutex']>;

interface Recorder {
  onModelSwitch: string[];
  begin: Array<[string, string]>;
  setAbort: Array<[string, AbortController]>;
  setExecId: Array<[string, string]>;
  waited: string[];
  persisted: Message[];
  created: Array<{ content: string; sessionId: string }>;
  started: string[];
  hookCalls: number;
}

function makeSession(messages: Message[] = []): ChatSession {
  return {
    id: 'sess-1',
    metadata: { roundCount: 2 },
    messages,
  } as unknown as ChatSession;
}

function makeDeps(opts: {
  sessionId?: string | null;
  session?: ChatSession | undefined;
  existingAbort?: AbortController;
  hookMessage?: string;
}): { deps: StreamSetupDeps; rec: Recorder; session: ChatSession } {
  const session = opts.session ?? makeSession();
  const rec: Recorder = {
    onModelSwitch: [],
    begin: [],
    setAbort: [],
    setExecId: [],
    waited: [],
    persisted: [],
    created: [],
    started: [],
    hookCalls: 0,
  };

  const deps: StreamSetupDeps = {
    currentSessionId: () =>
      opts.sessionId === undefined ? session.id : opts.sessionId,
    getOrLoadSession: async () => ('session' in opts ? opts.session : session),
    onModelSwitch: (model) => rec.onModelSwitch.push(model),
    beginStreamSession: (sessionId, model) =>
      rec.begin.push([sessionId, model]),
    getExistingAbort: () => opts.existingAbort,
    waitForAbortSettled: async (sessionId) => {
      rec.waited.push(sessionId);
    },
    setAbortController: (sessionId, controller) =>
      rec.setAbort.push([sessionId, controller]),
    setExecutionId: (sessionId, executionId) =>
      rec.setExecId.push([sessionId, executionId]),
    checkpointService: {} as unknown as StreamSetupDeps['checkpointService'],
    getOrCreateMutex: () => ({}) as unknown as Mutex,
    executePreMessageHook: async () => {
      rec.hookCalls += 1;
      return {
        before: opts.hookMessage
          ? [{ data: { message: opts.hookMessage } }]
          : [],
      };
    },
    createUserMessage: (content, options) => {
      rec.created.push({ content, sessionId: options.sessionId });
      return { id: 'generated-1', role: 'user', content } as unknown as Message;
    },
    addAndPersistMessage: (_sessionId, message) => rec.persisted.push(message),
    startProcessing: (sessionId) => rec.started.push(sessionId),
  };

  return { deps, rec, session };
}

describe('ChatStreamSetup.prepare 既有行为', () => {
  it('无 sessionId ⇒ VALIDATION 错误', async () => {
    const { deps } = makeDeps({ sessionId: null });
    const err = await new ChatStreamSetup(deps)
      .prepare('hi')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).message).toBe('No session id provided');
    expect((err as AppError).category).toBe(ErrorCategory.VALIDATION);
  });

  it('会话取不到 ⇒ EXECUTION 错误', async () => {
    const { deps } = makeDeps({ session: undefined });
    const err = await new ChatStreamSetup(deps)
      .prepare('hi')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).message).toBe('No session found or created');
    expect((err as AppError).category).toBe(ErrorCategory.EXECUTION);
  });

  it('正常准备 ⇒ 出参齐全且各依赖按序被调用', async () => {
    const { deps, rec, session } = makeDeps({});
    const result = await new ChatStreamSetup(deps).prepare('你好', {
      model: 'model-x',
    });

    expect(result.content).toBe('你好');
    expect(result.session).toBe(session);
    expect(result.streamAbortController).toBeInstanceOf(AbortController);
    expect(result.mutex).toBeDefined();
    expect(result.streamSpan).toBeDefined();
    expect(result.userMessage.id).toBe('generated-1');

    expect(rec.onModelSwitch).toEqual(['model-x']);
    expect(rec.begin).toEqual([['sess-1', 'model-x']]);
    expect(rec.setAbort).toHaveLength(1);
    expect(rec.setAbort[0][0]).toBe('sess-1');
    expect(rec.setAbort[0][1]).toBe(result.streamAbortController);
    expect(rec.started).toEqual(['sess-1']);
    expect(rec.hookCalls).toBe(1);
    expect(rec.persisted).toHaveLength(1);
    expect(rec.persisted[0].content).toBe('你好');
    // 轮次记账：metadata.roundCount 自增 1
    expect(session.metadata.roundCount).toBe(3);
  });

  it('options.executionId ⇒ 登记到该会话', async () => {
    const { deps, rec } = makeDeps({});
    await new ChatStreamSetup(deps).prepare('hi', { executionId: 'exec-9' });
    expect(rec.setExecId).toEqual([['sess-1', 'exec-9']]);
  });

  it('无 executionId ⇒ 不登记', async () => {
    const { deps, rec } = makeDeps({});
    await new ChatStreamSetup(deps).prepare('hi');
    expect(rec.setExecId).toEqual([]);
  });

  it('旧流存在 ⇒ 先 abort 并等待其收敛', async () => {
    const existing = new AbortController();
    const { deps, rec } = makeDeps({ existingAbort: existing });
    await new ChatStreamSetup(deps).prepare('hi');

    expect(existing.signal.aborted).toBe(true);
    expect(rec.waited).toEqual(['sess-1']);
  });

  it('外部 signal 已中止 ⇒ 内部 controller 立即同因中止', async () => {
    const external = new AbortController();
    external.abort('external-reason');
    const { deps } = makeDeps({});
    const result = await new ChatStreamSetup(deps).prepare('hi', {
      signal: external.signal,
    });

    expect(result.streamAbortController.signal.aborted).toBe(true);
    expect(result.streamAbortController.signal.reason).toBe('external-reason');
  });

  it('外部 signal 后中止 ⇒ 中继到内部 controller', async () => {
    const external = new AbortController();
    const { deps } = makeDeps({});
    const result = await new ChatStreamSetup(deps).prepare('hi', {
      signal: external.signal,
    });

    expect(result.streamAbortController.signal.aborted).toBe(false);
    external.abort('later');
    expect(result.streamAbortController.signal.aborted).toBe(true);
    expect(result.streamAbortController.signal.reason).toBe('later');
  });

  it('pre-message hook 改写 content ⇒ 出参与落盘消息均用改写值', async () => {
    const { deps, rec } = makeDeps({ hookMessage: '改写后的内容' });
    const result = await new ChatStreamSetup(deps).prepare('原始内容');

    expect(result.content).toBe('改写后的内容');
    expect(rec.created[0].content).toBe('改写后的内容');
    expect(rec.persisted[0].content).toBe('改写后的内容');
  });

  it('messageId 已在内存 ⇒ 复用该消息，不再创建/落盘', async () => {
    const preExisting = {
      id: 'msg-9',
      role: 'user',
      content: '先前已落盘',
    } as unknown as Message;
    const { deps, rec } = makeDeps({ session: makeSession([preExisting]) });

    const result = await new ChatStreamSetup(deps).prepare('hi', {
      messageId: 'msg-9',
    });

    expect(result.userMessage).toBe(preExisting);
    expect(rec.created).toHaveLength(0);
    expect(rec.persisted).toHaveLength(0);
  });

  it('messageId 不在内存 ⇒ 新建消息并沿用该 id 落盘', async () => {
    const { deps, rec } = makeDeps({});
    const result = await new ChatStreamSetup(deps).prepare('hi', {
      messageId: 'msg-9',
    });

    expect(result.userMessage.id).toBe('msg-9');
    expect(rec.persisted).toHaveLength(1);
    expect(rec.persisted[0].id).toBe('msg-9');
  });

  it('_fromInternal=true ⇒ 仍计一轮（roundCount 自增）', async () => {
    const { deps, session } = makeDeps({});
    await new ChatStreamSetup(deps).prepare('hi', { _fromInternal: true });
    expect(session.metadata.roundCount).toBe(3);
  });
});
