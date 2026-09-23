/**
 * B1-9 可注入性前置（2026-09-22）：真引擎 `execute()` 端到端用例。
 *
 * 覆盖此前无法验证的两条：
 * 1. **0a**：worker 进台账（修复前 worker 只登记在引擎自持 Map，`AgentRunLedger`
 *    看不见 ⇒ `hasLiveRunsForSession` 恒 false ⇒ 父会话被过早恢复）；
 * 2. **B1-5**：`endRun` 的**引用相等校验**（修复前无条件 `delete(agentId)` ⇒
 *    同 id 重跑时旧 run 会注销新 run 的句柄与条目）。
 *
 * 注入方式：`SubAgentEngineConfig.llmClientOverride`（B1-9 新增的测试缝）——
 * 使本用例**不依赖**"模型已注册供应商"，也不触网。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import type { AIProvider } from '@modules/ai';
import type { ChatResponse } from '@modules/ai';
import {
  getAgentRunLedger,
  resetAgentRunLedger,
} from '../../../src/tools/AgentTool/AgentRunLedger';
import { SubAgentEngine } from '../../../src/tools/AgentTool/SubAgentEngine';

const SID = 'sess-b19';

/** 最小假供应商：`chat` 直接返回无工具调用的收尾响应（1 轮完成） */
function makeFakeProvider(): AIProvider {
  return {
    id: 'fake-provider',
    displayName: 'fake',
    chat: async () =>
      ({
        content: 'done',
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }) as unknown as ChatResponse,
    // 本路径走 `chat`（非流式）⇒ 生成器不会被消费

    chatStream: async function* (): AsyncGenerator<
      string,
      ChatResponse,
      unknown
    > {
      return { content: '' } as ChatResponse;
    },

    listModels: async () => ['fake-model'],
    validateConfig: () => ({ valid: true, errors: [], warnings: [] }),
  };
}

describe('B1-9：真引擎 execute 端到端（注入假供应商）', () => {
  beforeEach(() => {
    resetAgentRunLedger();
  });

  afterEach(() => {
    resetAgentRunLedger();
  });

  test('worker 进台账并终态收敛（0a）；额度不重复计（weight 0）', async () => {
    const ledger = getAgentRunLedger();
    const engine = new SubAgentEngine({
      llmClientOverride: makeFakeProvider(),
    });
    const workerId = 'batch-Z::t1';

    const result = await engine.execute({
      agentId: workerId,
      systemPrompt: '你是测试 worker',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      toolInstances: new Map(),
      maxTurns: 1,
      model: 'fake-model',
      toolContext: { sessionId: SID } as never,
    });

    // 修复前：worker 从不进台账 ⇒ 下面第一处断言必失败
    const view = ledger.view(workerId);
    expect(view).toBeDefined();
    expect(view?.status).toBe(result.completed ? 'completed' : 'failed');
    // 无悬挂条目 + 引擎句柄表已清空
    expect(ledger.hasLiveRunsForSession(SID)).toBe(false);
    expect(engine.getActiveAgents()).toHaveLength(0);
    // 额度：worker 以 weight 0 登记（已由批次预留覆盖）⇒ 不产生额外占用
    expect(ledger.liveCount()).toBe(0);
  });

  test('endRun 引用校验：旧 run 的句柄不收敛新 run 的登记（B1-5）', () => {
    const ledger = getAgentRunLedger();
    const engine = new SubAgentEngine();

    const current = {
      abortController: new AbortController(),
      startTime: Date.now(),
    };
    const stale = {
      abortController: new AbortController(),
      startTime: Date.now(),
    };
    ledger.ensureCoveredRun({
      id: 'w-x',
      name: 'w-x',
      type: 'general',
      sessionId: SID,
    });
    // 模拟"同 id 重跑"：句柄表里已被**新 run** 接管
    Reflect.set(engine, 'activeAgents', new Map([['w-x', current]]));
    const endRun = Reflect.get(engine, 'endRun') as (
      id: string,
      status: 'completed' | 'failed',
      handle?: unknown
    ) => void;

    // 旧 run 结束（句柄 ≠ 当前登记）⇒ **不得**收敛
    endRun.call(engine, 'w-x', 'failed', stale);
    expect(
      (Reflect.get(engine, 'activeAgents') as Map<string, unknown>).has('w-x')
    ).toBe(true);
    expect(ledger.view('w-x')?.status).toBe('running');

    // 当前登记的句柄结束 ⇒ 正常收敛
    endRun.call(engine, 'w-x', 'completed', current);
    expect(
      (Reflect.get(engine, 'activeAgents') as Map<string, unknown>).has('w-x')
    ).toBe(false);
    expect(ledger.view('w-x')?.status).toBe('completed');
  });

  /**
   * M-1（P0-4）：**取消受理 ≠ 终态**。
   *
   * 修复前 `abort()` 直接 `endRun('failed')` ⇒ 取消受理即落终态 ⇒ 并发槽位**提前释放**
   *（`liveCount()` 失真）。修复后：`requestCancel()` 落非终态 `cancel_requested`（仍占额），
   * 终态由被中止 run 的收敛路径（`execute()` 出口的 `endRun`）落定。
   */
  test('M-1：abort 先受理（cancel_requested，槽位不释放），终态由收敛路径落定', () => {
    const ledger = getAgentRunLedger();
    const engine = new SubAgentEngine();
    const handle = {
      abortController: new AbortController(),
      startTime: Date.now(),
    };

    ledger.register({
      id: 'a-m1',
      name: 'a-m1',
      type: 'general',
      sessionId: SID,
      weight: 1,
    });
    Reflect.set(engine, 'activeAgents', new Map([['a-m1', handle]]));

    expect(engine.abort('a-m1')).toBe(true);
    // 修复前：此处为 'failed'（终态）且 liveCount 归 0
    expect(ledger.view('a-m1')?.status).toBe('cancel_requested');
    expect(ledger.liveCount()).toBe(1);
    // 受理后"是否仍应等待"仍为真 ⇒ 父会话不得在取消收敛前被恢复
    expect(ledger.hasLiveRunsForSession(SID)).toBe(true);

    // 收敛路径落终态（引用相等）
    const endRun = Reflect.get(engine, 'endRun') as (
      id: string,
      status: 'completed' | 'failed',
      h?: unknown
    ) => void;
    endRun.call(engine, 'a-m1', 'failed', handle);
    expect(ledger.view('a-m1')?.status).toBe('failed');
    expect(ledger.liveCount()).toBe(0);
    expect(ledger.hasLiveRunsForSession(SID)).toBe(false);
  });
});
