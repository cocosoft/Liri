/**
 * G-7（2026-10-18）—— **多 Agent 并发状态隔离取证**。
 *
 * 背景（清单 §6 G-7）：`CouncilOrchestrator` 是**进程级单例**（`_agentsMap` 为实例字段），
 * `CouncilEngine` 持有 `activeSessions`；Google 的「State Divergence」此前仅为推断。
 *
 * 本文件用**真实** `CouncilEngine` + `CouncilOrchestrator`（只把模型调用替换为本地探针，
 * 不触网、不读 DB），跑「2 会话 × 10 轮」并发，验证三件事：
 *   ① `_agentsMap` 是否跨会话串扰（同 `agentId`、不同 `systemPrompt` 的两会话并发时，
 *      A 的发言是否拿到 B 的 systemPrompt）；
 *   ② 事件流是否串扰（每个事件的 `sessionId` 是否属于本会话，事件数是否守恒）；
 *   ③ `startCouncil` 的**进程级缓存**是否按 workspace / ownerSession 隔离
 *      （同 topic、不同 workspace 的第二次调用是否拿到第一次的会话对象）。
 *
 * 判定（清单）：出现任一状态串扰 ⇒ 立项修复（优先"按 run 的上下文隔离"，而非全局锁）。
 */
import { describe, expect, it } from 'bun:test';
import { CouncilEngine } from '../../src/workspace/CouncilEngine';
import { CouncilOrchestrator } from '../../src/workspace/CouncilOrchestrator';
import type {
  CouncilAgentRole,
  CouncilSession,
  CouncilStreamEvent,
} from '../../src/workspace/CouncilTypes';

const PROMPT_A = 'G7-ROLE-PROMPT-A';
const PROMPT_B = 'G7-ROLE-PROMPT-B';

/** 同 `agentId`、不同 systemPrompt ⇒ 共享 map 一旦被并发覆盖，A 会拿到 B 的 prompt */
function agentsWithPrompt(prompt: string): CouncilAgentRole[] {
  return [
    {
      agentId: 'shared-expert',
      name: '专家',
      expertise: ['test'],
      weight: 1,
      systemPrompt: prompt,
    },
  ];
}

/**
 * 探针编排器：**只**替换私有 `callAI`（模型调用），其余（`statementCallback`、
 * `_agentsMap` 读写、session 流转）全部走生产实现。
 *
 * 用实例属性遮蔽原型方法 ⇒ 不污染全局 `aiService`，也不影响并行运行的其他测试文件。
 */
class ProbeOrchestrator extends CouncilOrchestrator {
  calls: Array<{ system: string; user: string }> = [];

  constructor(engine: CouncilEngine) {
    super(engine);
    (
      this as unknown as {
        callAI: (systemPrompt: string, userPrompt: string) => Promise<string>;
      }
    ).callAI = async (systemPrompt: string, userPrompt: string) => {
      this.calls.push({ system: systemPrompt, user: userPrompt });
      // 让出事件循环：并发双方都有机会推进（复现真实交错）
      await new Promise<void>((r) => setTimeout(r, 1));
      // 共识判定：返回合法 JSON（statement 用纯文本即可，走解析回退分支）
      if (systemPrompt.includes('技术决策主持人')) {
        return JSON.stringify({
          result: 'unanimous',
          finalProposal: 'proposal',
          minorityOpinion: null,
        });
      }
      return 'statement-content';
    };
  }
}

function makeEngine(): { engine: CouncilEngine; events: CouncilStreamEvent[] } {
  const events: CouncilStreamEvent[] = [];
  return { engine: new CouncilEngine((e) => events.push(e)), events };
}

/** 跑一轮并发（两个会话、同 agentId、不同 prompt / 不同 topic） */
async function runPair(
  orch: ProbeOrchestrator,
  engine: CouncilEngine,
  salt: string
): Promise<{ a: CouncilSession; b: CouncilSession }> {
  const topicA = `G7-TOPIC-A-${salt}`;
  const topicB = `G7-TOPIC-B-${salt}`;
  const a = engine.createSession(
    'ws-A',
    topicA,
    'ctx-A',
    agentsWithPrompt(PROMPT_A),
    {
      maxRounds: 2,
    }
  );
  const b = engine.createSession(
    'ws-B',
    topicB,
    'ctx-B',
    agentsWithPrompt(PROMPT_B),
    {
      maxRounds: 2,
    }
  );
  orch.calls.length = 0;
  await Promise.all([orch.runDebate(a.sessionId), orch.runDebate(b.sessionId)]);
  return { a, b };
}

describe('G-7 并发隔离：_agentsMap（2 会话 × 10 轮）', () => {
  it('A 的每一轮发言都使用 A 的 systemPrompt（不被 B 覆盖）', async () => {
    const { engine } = makeEngine();
    const orch = new ProbeOrchestrator(engine);

    for (let i = 0; i < 10; i++) {
      const { a } = await runPair(orch, engine, `agents-${i}`);
      const topicA = a.topic;
      const wrong = orch.calls.filter(
        (c) => c.user.includes(topicA) && c.system === PROMPT_B
      );
      expect(wrong).toEqual([]);
      // 对照：A 确实用了自己的 prompt（排除"全都没用上自定义 prompt"的假通过）
      const right = orch.calls.filter(
        (c) => c.user.includes(topicA) && c.system === PROMPT_A
      );
      expect(right.length).toBeGreaterThan(0);
    }
  });
});

describe('G-7 并发隔离：会话状态与事件流', () => {
  it('两会话的 statements / currentRound 各自守恒，事件 sessionId 不串台', async () => {
    const { engine, events } = makeEngine();
    const orch = new ProbeOrchestrator(engine);

    for (let i = 0; i < 10; i++) {
      // 每轮清空事件收集器（否则上一轮的 sessionId 会污染"缺位检查"）
      events.length = 0;
      const { a, b } = await runPair(orch, engine, `state-${i}`);
      // 会话状态：各 1 agent × 2 round = 2 条 statement，且轮次推进到 maxRounds
      expect(a.statements.length).toBe(2);
      expect(b.statements.length).toBe(2);
      expect(a.currentRound).toBe(2);
      expect(b.currentRound).toBe(2);
      expect(a.topic).not.toBe(b.topic);
      expect(a.workspaceId).toBe('ws-A');
      expect(b.workspaceId).toBe('ws-B');
      expect(a.sessionId).not.toBe(b.sessionId);

      // 事件流：每个事件的 sessionId 必须是本对会话之一
      const ids = new Set([a.sessionId, b.sessionId]);
      const stray = events.filter((e) => !ids.has(e.sessionId));
      expect(stray).toEqual([]);
    }
  });
});

describe('G-7 并发隔离：startCouncil 缓存作用域', () => {
  it('同 topic、不同 workspace / ownerSession ⇒ 不得复用同一会话对象', async () => {
    const { engine } = makeEngine();
    const orch = new ProbeOrchestrator(engine);
    const topic = `G7-CACHE-${Date.now()}-${Math.random()}`;

    const a = await orch.startCouncil(
      'ws-A',
      topic,
      'ctx-A',
      agentsWithPrompt(PROMPT_A),
      {
        maxRounds: 1,
        ownerSessionId: 'chat-A',
      }
    );
    const b = await orch.startCouncil(
      'ws-B',
      topic,
      'ctx-B',
      agentsWithPrompt(PROMPT_B),
      {
        maxRounds: 1,
        ownerSessionId: 'chat-B',
      }
    );

    expect(b.sessionId).not.toBe(a.sessionId);
    expect(b.workspaceId).toBe('ws-B');
    expect(b.ownerSessionId).toBe('chat-B');
  });
});
