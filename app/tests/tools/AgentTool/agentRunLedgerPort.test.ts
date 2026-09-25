/**
 * P2-6（2026-09-25）：Agent run 台账**接口契约**（`.trae/specs/agent-run-ports.md`）。
 *
 * 覆盖 spec §6：
 * - **契约完整性**：`AgentRunLedger` 实例具备接口声明的全部方法（运行时断言，防反射/`as any`
 *   路径绕过编译期检查）；
 * - **可替换性（G3）**：接受 `AgentRunFactsPort` 的消费方可被**内存桩**替换 ⇒ 契约真的可用于注入。
 *
 * **不使用 `mock.module`**（上轮教训：进程级替换会跨文件泄漏）。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  AgentRunLedger,
  resetAgentRunLedger,
  getAgentRunLedger,
  type AgentRunFactsPort,
  type AgentRunLedgerPort,
} from '../../../src/tools/AgentTool/AgentRunLedger';

/** 接口声明的全部方法（**契约清单**；漏实现即编译期报错，此处再运行时兜底） */
const PORT_METHODS: ReadonlyArray<keyof AgentRunLedgerPort> = [
  'isLive',
  'hasLiveRunsForSession',
  'liveCount',
  'recentCount',
  'view',
  'viewActive',
  'listActive',
  'ownerSessionId',
  'register',
  'tryReserve',
  'ensureCoveredRun',
  'requestCancel',
  'settle',
];

/** 只依赖**判据面**的消费方示例（证明契约可用于替换实现） */
function summarize(facts: AgentRunFactsPort): {
  live: number;
  hasLive: boolean;
  owner?: string;
} {
  return {
    live: facts.liveCount(),
    hasLive: facts.hasLiveRunsForSession('s-target'),
    owner: facts.ownerSessionId('a1'),
  };
}

beforeEach(() => {
  resetAgentRunLedger();
});

afterEach(() => {
  resetAgentRunLedger();
});

describe('P2-6 台账接口契约', () => {
  test('AgentRunLedger 实例具备契约声明的全部方法', () => {
    const ledger = new AgentRunLedger();
    for (const method of PORT_METHODS) {
      expect(typeof ledger[method]).toBe('function');
    }
  });

  test('单例同样满足契约（消费方实际取用的实例）', () => {
    const ledger = getAgentRunLedger();
    for (const method of PORT_METHODS) {
      expect(typeof ledger[method]).toBe('function');
    }
  });

  test('判据面可用**内存桩**替换：消费方按契约取值（G3 可替换性）', () => {
    const stub: AgentRunFactsPort = {
      isLive: () => true,
      hasLiveRunsForSession: (sessionId) => sessionId === 's-target',
      liveCount: () => 7,
      recentCount: () => 0,
      view: () => undefined,
      viewActive: () => undefined,
      listActive: () => [],
      ownerSessionId: (agentId) => (agentId === 'a1' ? 's-stub' : undefined),
    };

    expect(summarize(stub)).toEqual({
      live: 7,
      hasLive: true,
      owner: 's-stub',
    });
  });

  test('真台账经同一判据面读出真实值（契约两面通用）', () => {
    const ledger = getAgentRunLedger();
    ledger.register({
      id: 'a1',
      name: 'a1',
      type: 'general',
      sessionId: 's-target',
    });
    ledger.register({
      id: 'a2',
      name: 'a2',
      type: 'general',
      sessionId: 's-other',
    });

    const facts: AgentRunFactsPort = ledger;
    const out = summarize(facts);
    expect(out.live).toBe(2);
    expect(out.hasLive).toBe(true);
    expect(out.owner).toBe('s-target');
  });
});
