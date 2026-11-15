// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 编排模式决策只读统计（2026-11-15，`/patterns stats`）
 *
 * 钉住三件事：
 * ① **按 sessionId 去重**（同一会话多轮命中只算一个会话）；
 * ② **只认结构化字段**（`selected` / `applied` / `featureGate.enabled`，CS02）；
 * ③ 判据① 阈值 20 会话（`default-off-switches-review-gates.md` §2 #11）。
 */
import { describe, expect, it } from 'bun:test';

import type { LiriEvent } from '@modules/session/types/events';
import {
  PATTERN_DECISION_GATE_MIN_SESSIONS,
  summarizePatternDecisions,
} from '@modules/tasks';
import { createPatternsCommand } from '../../../src/commands/builtin/patterns/Patterns';

/** 造一条 `pattern/decision` 事件 */
function decision(
  sessionId: string,
  data: {
    site?: 'turn_dispatch' | 'research_dispatch';
    selected: string | null;
    applied: boolean;
    gateEnabled?: boolean;
  }
): LiriEvent {
  return {
    type: 'pattern/decision',
    seq: 0,
    time: 0,
    sessionId,
    data: {
      site: data.site ?? 'turn_dispatch',
      selected: data.selected,
      applied: data.applied,
      ...(data.gateEnabled === undefined
        ? {}
        : {
            featureGate: {
              flag: 'SELF_VERIFY_PATTERN',
              enabled: data.gateEnabled,
            },
          }),
    },
  } as LiriEvent;
}

describe('summarizePatternDecisions（只读统计）', () => {
  it('空输入 ⇒ 全零且未达阈值', () => {
    const s = summarizePatternDecisions([]);
    expect(s.sessionsScanned).toBe(0);
    expect(s.decisionEvents).toBe(0);
    expect(s.verifySessions).toBe(0);
    expect(s.meetsGateThreshold).toBe(false);
  });

  it('同一会话多轮命中 ⇒ 只算一个会话', () => {
    const s = summarizePatternDecisions([
      {
        sessionId: 's1',
        events: [
          decision('s1', { selected: 'self_verify', applied: false }),
          decision('s1', { selected: 'self_verify', applied: true }),
        ],
      },
    ]);
    expect(s.decisionEvents).toBe(2);
    expect(s.sessionsWithDecision).toBe(1);
    expect(s.verifySessions).toBe(1);
    expect(s.selfVerifySessions).toBe(1);
    expect(s.appliedSessions).toBe(1);
  });

  it('verify 与 refine 合并计入判据①；research 单独计数', () => {
    const s = summarizePatternDecisions([
      {
        sessionId: 'a',
        events: [
          decision('a', {
            selected: 'self_verify',
            applied: true,
            gateEnabled: true,
          }),
        ],
      },
      {
        sessionId: 'b',
        events: [
          decision('b', { selected: 'iterative_refine', applied: true }),
        ],
      },
      {
        sessionId: 'c',
        events: [
          decision('c', {
            selected: 'competitive_strategy',
            applied: true,
            site: 'research_dispatch',
          }),
        ],
      },
      { sessionId: 'd', events: [] },
    ]);
    expect(s.sessionsScanned).toBe(4);
    expect(s.sessionsWithDecision).toBe(3);
    expect(s.verifySessions).toBe(2);
    expect(s.selfVerifySessions).toBe(1);
    expect(s.refineSessions).toBe(1);
    expect(s.researchSessions).toBe(1);
    expect(s.gateEnabledSessions).toBe(1);
  });

  it('达到阈值 20 会话 ⇒ meetsGateThreshold=true', () => {
    const sessions = Array.from(
      { length: PATTERN_DECISION_GATE_MIN_SESSIONS },
      (_, i) => ({
        sessionId: `s${i}`,
        events: [
          decision(`s${i}`, { selected: 'self_verify', applied: false }),
        ],
      })
    );
    expect(summarizePatternDecisions(sessions).meetsGateThreshold).toBe(true);
  });
});

describe('createPatternsCommand（命令层）', () => {
  it('stats 汇总并点名判据① 未达阈值', async () => {
    const cmd = createPatternsCommand({
      listSessionIds: async () => ['s1'],
      readEvents: async (sid) => [
        decision(sid, {
          selected: 'self_verify',
          applied: false,
          gateEnabled: false,
        }),
      ],
    });
    const result = await cmd.stats('');
    expect(result.success).toBe(true);
    expect(result.message).toContain('验证线路命中会话：1 / 20');
    expect(result.message).toContain('未达阈值（还差 19）');
  });

  it('未知子命令 ⇒ 失败并给出用法', async () => {
    const cmd = createPatternsCommand({
      listSessionIds: async () => [],
      readEvents: async () => [],
    });
    const result = await cmd.execute('nope', {} as never);
    expect(result.success).toBe(false);
    expect(result.error).toContain('用法');
  });
});
