/**
 * U-14：CouncilEngine 实现可选 `ISnapshotCapable`（freeze/resume）。
 *
 * 覆盖：
 * ① `isSnapshotCapable()` 探测为 true；
 * ② freeze 后新增的会话在 resume 后消失（快照覆盖内存态）；
 * ③ 恢复的会话字段完整（phase / statements / currentRound）；
 * ④ 非法句柄显式报错（不静默吞掉）。
 */
import { describe, expect, it } from 'bun:test';
import { CouncilEngine } from '../../src/workspace/CouncilEngine.js';
import { isSnapshotCapable } from '../../src/utils/toolContract/Tool.js';
import type { CouncilAgentRole } from '../../src/workspace/CouncilTypes.js';

const AGENTS: CouncilAgentRole[] = [
  {
    agentId: 'a1',
    name: 'Architect',
    expertise: ['architecture'],
    weight: 1,
  },
];

function createEngine(): CouncilEngine {
  return new CouncilEngine(() => {
    // 测试不关心流式事件
  });
}

describe('U-14 CouncilEngine snapshot capability', () => {
  it('声明并可被 isSnapshotCapable 探测', () => {
    const engine = createEngine();
    expect(engine.snapshotCapable).toBe(true);
    expect(isSnapshotCapable(engine)).toBe(true);
  });

  it('freeze → 新增会话 → resume：快照覆盖内存态', () => {
    const engine = createEngine();
    const first = engine.createSession('ws', 'topic-1', 'ctx', AGENTS, {
      maxRounds: 2,
    });
    first.phase = 'debating';
    first.currentRound = 1;
    first.statements.push({
      id: 's1',
      agentId: 'a1',
      agentName: 'Architect',
      round: 1,
      type: 'position',
      content: 'position',
      keyPoints: ['k1'],
      timestamp: Date.now(),
    });

    const handle = engine.freezeForSuspend();
    const second = engine.createSession('ws', 'topic-2', 'ctx', AGENTS);
    expect(engine.getSession(second.sessionId)).toBeDefined();

    engine.resumeFromSnapshot(handle);

    expect(engine.getSession(second.sessionId)).toBeUndefined();
    const restored = engine.getSession(first.sessionId);
    expect(restored).toBeDefined();
    expect(restored?.phase).toBe('debating');
    expect(restored?.currentRound).toBe(1);
    expect(restored?.statements).toHaveLength(1);
  });

  it('按会话冻结：只恢复目标会话，其它会话原样保留', () => {
    const engine = createEngine();
    // 关联键是聊天会话（ownerSessionId），不是辩论自身 UUID
    const mine = engine.createSession('ws', 'topic-mine', 'ctx', AGENTS, {
      ownerSessionId: 'chat-1',
    });
    const other = engine.createSession('ws', 'topic-other', 'ctx', AGENTS, {
      ownerSessionId: 'chat-2',
    });
    mine.phase = 'debating';
    const frozenRound = mine.currentRound;

    const handle = engine.freezeForSuspend({ sessionId: 'chat-1' });
    expect(handle.mode).toBe('session');
    expect(handle.sessionId).toBe('chat-1');
    expect((handle.sessions as unknown[]).length).toBe(1);

    // 冻结后：本会话继续推进 + 另开一场；其它会话也在推进
    mine.phase = 'completed';
    mine.currentRound = frozenRound + 5;
    const spawned = engine.createSession('ws', 'topic-new', 'ctx', AGENTS, {
      ownerSessionId: 'chat-1',
    });
    other.phase = 'completed';

    engine.resumeFromSnapshot(handle);

    // 本会话回到快照（含快照后新开的辩论被移除）
    expect(engine.getSession(mine.sessionId)?.phase).toBe('debating');
    expect(engine.getSession(mine.sessionId)?.currentRound).toBe(frozenRound);
    expect(engine.getSession(spawned.sessionId)).toBeUndefined();
    // 其它会话未被回滚
    expect(engine.getSession(other.sessionId)?.phase).toBe('completed');
  });

  it('作用域句柄缺 sessionId ⇒ 显式报错', () => {
    const engine = createEngine();
    expect(() =>
      engine.resumeFromSnapshot({
        kind: 'council-engine',
        mode: 'session',
        sessions: [],
      })
    ).toThrow('invalid council snapshot handle');
  });

  it('非法句柄显式报错', () => {
    const engine = createEngine();
    expect(() => engine.resumeFromSnapshot({ kind: 'wrong' })).toThrow(
      'invalid council snapshot handle'
    );
  });
});
