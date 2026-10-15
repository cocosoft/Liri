// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 「幽灵恢复」回归（2026-10-15，前端反馈「工具轮次」异常）：
//
// 缺陷：`ResumeManager.scanPending` 的过滤只有 goal / suspend / 过期三类 ⇒ **`phase === 'completed'`
// 的 `before_abort` 检查点**（用户主动中止、但中止时该轮已正常收尾）在 24h 内**每次启动都被恢复**
// —— 真机会话 `diag-budget-gate-2` 于 10:02→11:17 被恢复 8 次（随进程反复启动复发），
// 每次注入 steering 并建 TAORLoop ⇒ 会话轮次/消息被反复累加。
//
// 修复：已完成（`phase === 'completed'`）⇒ 无待续推理，不作 Durable Resume 候选。
// 负向：suspend / goal 的既有排除判据保持不变；真正"跑到一半中断"（phase !== 'completed'）仍可续跑。

import { describe, it, expect } from 'bun:test';
import { ResumeManager } from '../../src/query/ResumeManager.js';
import type {
  TAORCheckpoint,
  TAORCheckpointStorage,
} from '../../src/query/types.js';

function ck(p: {
  id: string;
  sessionId: string;
  phase: string;
  type?: string;
  kind?: string;
  ageMs?: number;
}): TAORCheckpoint {
  return {
    id: p.id,
    sessionId: p.sessionId,
    turnCount: 1,
    phase: p.phase,
    type: p.type ?? 'before_abort',
    kind: p.kind,
    createdAt: Date.now() - (p.ageMs ?? 60_000),
  } as unknown as TAORCheckpoint;
}

function makeStorage(
  map: Record<string, TAORCheckpoint>
): TAORCheckpointStorage {
  return {
    getPendingSessions: async () => Object.keys(map),
    getLatestIncomplete: async (sid: string) => map[sid] ?? null,
    deleteSession: async () => 0,
  } as unknown as TAORCheckpointStorage;
}

describe('Durable Resume：`phase=completed` 防护（幽灵恢复）', () => {
  it('① completed 检查点不入候选；未收尾的仍入候选', async () => {
    const mgr = new ResumeManager(
      makeStorage({
        'sess-completed': ck({
          id: 'cp-completed',
          sessionId: 'sess-completed',
          phase: 'completed',
        }),
        'sess-running': ck({
          id: 'cp-running',
          sessionId: 'sess-running',
          phase: 'reasoning',
        }),
      })
    );
    const ids = (await mgr.scanPending()).map((c) => c.sessionId);
    expect(ids).not.toContain('sess-completed');
    expect(ids).toContain('sess-running');
  });

  it('② 负向：suspend / goal 仍按既有判据排除（判据不被本次改动覆盖）', async () => {
    const mgr = new ResumeManager(
      makeStorage({
        'sess-suspend': ck({
          id: 'cp-suspend',
          sessionId: 'sess-suspend',
          phase: 'reasoning',
          type: 'budget_suspend',
        }),
        'sess-goal': ck({
          id: 'cp-goal',
          sessionId: 'sess-goal',
          phase: 'reasoning',
          type: 'auto',
          kind: 'goal',
        }),
      })
    );
    expect((await mgr.scanPending()).length).toBe(0);
  });

  it('③ 负向：过期（>24h）检查点仍按既有判据排除', async () => {
    const mgr = new ResumeManager(
      makeStorage({
        'sess-old': ck({
          id: 'cp-old',
          sessionId: 'sess-old',
          phase: 'reasoning',
          ageMs: 25 * 60 * 60 * 1000,
        }),
      })
    );
    expect((await mgr.scanPending()).length).toBe(0);
  });
});
