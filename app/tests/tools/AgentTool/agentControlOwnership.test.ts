/**
 * AgentTool 控制面归属校验（O14）+ 台账跨实例单一所有者（O15）
 *
 * 背景（第二轮复查 N4/N6）：
 * - 原 `stopAgent` 的归属校验是 `if (owner && owner !== requester)`；
 *   **`owner === undefined` 时放行**，而并行批次的 worker（引擎侧 id `swarm-<id>`）
 *   不经 `AgentRunLedger.register` ⇒ owner 恒 undefined ⇒ 任意会话拿到 id 即可中止它。
 *   本轮改为 **fail-closed**：owner 缺失即拒绝；进程内特权调用须**显式** `privileged: true`。
 * - 台账原为 `AgentTool` 的**实例字段**，而 `AgentTool` 有多个构造点 ⇒
 *   "能否再开一个"只按单实例计数、"是否仍需等待"却按全局会话判定。本轮改为共享单例。
 *
 * 说明：与 `parallelTasks.test.ts` 同法注入 fake 引擎（`Reflect.set`，不使用 any / ts-ignore）。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { AgentTool } from '../../../src/tools/AgentTool/AgentTool';
import {
  getAgentRunLedger,
  resetAgentRunLedger,
} from '../../../src/tools/AgentTool/AgentRunLedger';
import {
  registerSessionLineage,
  resetSessionLineage,
} from '../../../src/session/lineage/sessionLineage';

/** fake 引擎：仅声明本测试路径用到的三个方法 */
interface EngineStub {
  execute: () => Promise<{ output: string; completed?: boolean }>;
  abort: (agentId: string) => boolean;
  ownerSessionId: (agentId: string) => string | undefined;
}

/** 注入 fake 引擎并记录 `abort` 调用（用于断言"拒绝 ⇒ 绝不下发中止"） */
function installEngine(
  tool: AgentTool,
  owners: Record<string, string> = {}
): { aborted: string[] } {
  const aborted: string[] = [];
  const stub: EngineStub = {
    execute: async () => ({ output: '', completed: true }),
    abort: (agentId: string) => {
      aborted.push(agentId);
      return true;
    },
    ownerSessionId: (agentId: string) => owners[agentId],
  };
  Reflect.set(tool, 'engine', stub);
  return { aborted };
}

/** 在共享台账中登记一个 run（模拟 `beginRun` 的登记结果） */
function registerRun(id: string, sessionId: string): void {
  getAgentRunLedger().register({
    id,
    name: id,
    type: 'general',
    sessionId,
  });
}

describe('AgentTool 控制面 Tier1 血缘链（O10b / v7.1）', () => {
  beforeEach(() => {
    resetAgentRunLedger();
    resetSessionLineage();
  });

  afterEach(() => {
    resetAgentRunLedger();
    resetSessionLineage();
  });

  test('请求方是归属会话的**祖先**（fork 血缘）⇒ 放行', () => {
    const tool = new AgentTool();
    const engine = installEngine(tool);
    registerRun('a-lineage', 'sess-child');
    registerSessionLineage('sess-child', 'sess-parent');

    expect(
      tool.stopAgent('a-lineage', { requesterSessionId: 'sess-parent' })
    ).toBe(true);
    expect(engine.aborted).toEqual(['a-lineage']);
  });

  test('多跳血缘（祖父）⇒ 放行', () => {
    const tool = new AgentTool();
    installEngine(tool);
    registerRun('a-lineage2', 'sess-c');
    registerSessionLineage('sess-c', 'sess-b');
    registerSessionLineage('sess-b', 'sess-a');

    expect(
      tool.stopAgent('a-lineage2', { requesterSessionId: 'sess-a' })
    ).toBe(true);
  });

  test('既非归属、也不在血缘链上 ⇒ 拒绝且不下发中止', () => {
    const tool = new AgentTool();
    const engine = installEngine(tool);
    registerRun('a-lineage3', 'sess-c');
    registerSessionLineage('sess-c', 'sess-b');

    expect(
      tool.stopAgent('a-lineage3', { requesterSessionId: 'sess-unrelated' })
    ).toBe(false);
    expect(engine.aborted).toEqual([]);
  });

  test('血缘链未覆盖（会话非本进程 fork 所得）⇒ fail-closed 拒绝', () => {
    const tool = new AgentTool();
    const engine = installEngine(tool);
    registerRun('a-lineage4', 'sess-x');

    // 未登记任何血缘 ⇒ 祖先判定不可得 ⇒ 拒绝（不会误放行）
    expect(
      tool.stopAgent('a-lineage4', { requesterSessionId: 'sess-y' })
    ).toBe(false);
    expect(engine.aborted).toEqual([]);
  });
});

describe('AgentTool 控制面归属校验（O14，fail-closed）', () => {
  beforeEach(() => {
    resetAgentRunLedger();
  });

  afterEach(() => {
    resetAgentRunLedger();
  });

  test('归属一致 ⇒ 受理取消（落 cancel_requested 中间态）', () => {
    const tool = new AgentTool();
    const engine = installEngine(tool);
    registerRun('a-1', 'sess-A');

    expect(tool.stopAgent('a-1', { requesterSessionId: 'sess-A' })).toBe(true);
    // O10a③：受理 ≠ 终态 —— 条目仍占并发槽位，终态由执行路径落定
    expect(getAgentRunLedger().view('a-1')?.status).toBe('cancel_requested');
    expect(engine.aborted).toEqual(['a-1']);
  });

  test('归属不一致 ⇒ 拒绝，且不下发中止、不写状态', () => {
    const tool = new AgentTool();
    const engine = installEngine(tool);
    registerRun('a-2', 'sess-A');

    expect(tool.stopAgent('a-2', { requesterSessionId: 'sess-B' })).toBe(false);
    expect(getAgentRunLedger().view('a-2')?.status).toBe('running');
    expect(engine.aborted).toEqual([]);
  });

  test('无归属记录（未知 id）+ 带请求方 ⇒ 拒绝（原实现在此放行）', () => {
    const tool = new AgentTool();
    const engine = installEngine(tool);

    expect(
      tool.stopAgent('swarm-unknown', { requesterSessionId: 'sess-A' })
    ).toBe(false);
    expect(engine.aborted).toEqual([]);
  });

  test('并行批次 worker（仅引擎侧有归属）⇒ 同会话可停、他会话不可停', () => {
    const tool = new AgentTool();
    // `swarm-1` 不在台账中，归属只能由引擎作答（O14-2：worker 已透传 toolContext）
    const engine = installEngine(tool, { 'swarm-1': 'sess-A' });

    expect(tool.stopAgent('swarm-1', { requesterSessionId: 'sess-B' })).toBe(
      false
    );
    expect(engine.aborted).toEqual([]);

    expect(tool.stopAgent('swarm-1', { requesterSessionId: 'sess-A' })).toBe(
      true
    );
    expect(engine.aborted).toEqual(['swarm-1']);
  });

  test('无请求方 + 无特权标志 ⇒ 拒绝（不再"不传即特权"）', () => {
    const tool = new AgentTool();
    const engine = installEngine(tool);
    registerRun('a-3', 'sess-A');

    expect(tool.stopAgent('a-3')).toBe(false);
    expect(getAgentRunLedger().view('a-3')?.status).toBe('running');
    expect(engine.aborted).toEqual([]);
  });

  test('无请求方 + 显式 privileged ⇒ 放行（进程内调用方）', () => {
    const tool = new AgentTool();
    const engine = installEngine(tool);
    registerRun('a-4', 'sess-A');

    expect(tool.stopAgent('a-4', { privileged: true })).toBe(true);
    expect(engine.aborted).toEqual(['a-4']);
  });
});

describe('台账跨实例单一所有者（O15）', () => {
  beforeEach(() => {
    resetAgentRunLedger();
  });

  afterEach(() => {
    resetAgentRunLedger();
  });

  test('同一进程内所有 AgentTool 实例共用同一台账', () => {
    const first = new AgentTool();
    const second = new AgentTool();

    expect(Reflect.get(first, '_ledger')).toBe(getAgentRunLedger());
    expect(Reflect.get(second, '_ledger')).toBe(getAgentRunLedger());
  });

  test('实例 A 登记的 run 占用实例 B 看到的并发额度（全局口径）', () => {
    const first = new AgentTool();
    const second = new AgentTool();
    void first;
    void second;

    registerRun('g-1', 'sess-A');
    expect(getAgentRunLedger().liveCount()).toBe(1);

    // 收口后额度释放（两个实例看到同一份账）
    getAgentRunLedger().settle('g-1', 'completed');
    expect(getAgentRunLedger().liveCount()).toBe(0);
  });
});
