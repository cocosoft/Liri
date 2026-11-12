/**
 * 围栏 M2：S1（静默放行空转）/ S2（deny 后重试）规则单测。
 *
 * 每条规则都同时覆盖**正例**与**误报防护**（这是 M2 的验收重点：
 * 观测规则最容易变成告警噪音）。
 */

import { describe, expect, it } from 'bun:test';

import {
  createFenceRuleState,
  evaluateAuditEvent,
  normalizeCommand,
  parseAuditEvent,
  type FenceAuditEvent,
  type FenceRuleConfig,
} from '../../src/entrypoints/fence/rules.js';

const CONFIG: FenceRuleConfig = {
  silentAllowRunLength: 3,
  // 既有用例默认关闭去重；去重行为由下方 A+C 专项用例显式覆盖
  silentAllowDedupWindowMs: 0,
  denyRetryWindowMs: 60_000,
};

function event(overrides: Partial<FenceAuditEvent> = {}): FenceAuditEvent {
  const command = overrides.command ?? 'ls';
  return {
    timestamp: '2026-11-12T10:00:00.000Z',
    command,
    normalizedCommand: normalizeCommand(command),
    behavior: 'allow',
    riskLevel: 'medium',
    matchedRulesCount: 1,
    ...overrides,
  };
}

/** 一次「无规则匹配 ⇒ 默认放行」事件（S1 的唯一计数条件） */
function silentAllow(timestamp: string, command = 'ls'): FenceAuditEvent {
  return event({
    timestamp,
    command,
    behavior: 'allow',
    riskLevel: 'high',
    matchedRulesCount: 0,
  });
}

describe('M2 / parseAuditEvent', () => {
  it('优先 originalCommand；缺失则回退 command', () => {
    const withOriginal = parseAuditEvent(
      JSON.stringify({
        timestamp: '2026-11-12T10:00:00.000Z',
        command: 'ls -la',
        originalCommand: 'ls   -la ',
        behavior: 'allow',
        riskLevel: 'medium',
        matchedRules: ['r1'],
      })
    );
    expect(withOriginal?.command).toBe('ls   -la ');
    expect(withOriginal?.normalizedCommand).toBe('ls -la');
    expect(withOriginal?.matchedRulesCount).toBe(1);
  });

  it('坏 JSON / 缺 timestamp / 缺命令 ⇒ undefined（不猜）', () => {
    expect(parseAuditEvent('not-json')).toBeUndefined();
    expect(parseAuditEvent(JSON.stringify({ command: 'ls' }))).toBeUndefined();
    expect(
      parseAuditEvent(JSON.stringify({ timestamp: '2026-11-12T10:00:00.000Z' }))
    ).toBeUndefined();
  });

  it('2026-11-13：解析 ruleCoverage / commandClass；未知取值不设（不猜）', () => {
    const parsed = parseAuditEvent(
      JSON.stringify({
        timestamp: '2026-11-12T10:00:00.000Z',
        command: 'grep foo',
        behavior: 'allow',
        riskLevel: 'high',
        matchedRules: [],
        ruleCoverage: 'uncovered',
        commandClass: 'read-only',
      })
    );
    expect(parsed?.ruleCoverage).toBe('uncovered');
    expect(parsed?.commandClass).toBe('read-only');

    const unknown = parseAuditEvent(
      JSON.stringify({
        timestamp: '2026-11-12T10:00:00.000Z',
        command: 'x',
        ruleCoverage: 'something-else',
        commandClass: 'weird',
      })
    );
    expect(unknown?.ruleCoverage).toBeUndefined();
    expect(unknown?.commandClass).toBeUndefined();
  });
});

describe('M2 / S1 静默放行空转', () => {
  it('连续 3 次「无规则匹配 ⇒ 默认放行」⇒ 第 3 次告警，随后重新计数', () => {
    const state = createFenceRuleState();
    expect(
      evaluateAuditEvent(silentAllow('2026-11-12T10:00:00.000Z'), state, CONFIG)
    ).toEqual([]);
    expect(
      evaluateAuditEvent(silentAllow('2026-11-12T10:00:01.000Z'), state, CONFIG)
    ).toEqual([]);
    const third = evaluateAuditEvent(
      silentAllow('2026-11-12T10:00:02.000Z'),
      state,
      CONFIG
    );
    expect(third.map((f) => f.kind)).toEqual(['silent-allow-streak']);

    // 已告警 ⇒ 计数清零，不会逐条刷屏
    expect(
      evaluateAuditEvent(silentAllow('2026-11-12T10:00:03.000Z'), state, CONFIG)
    ).toEqual([]);
  });

  it('误报防护：medium 风险 / 有命中规则 / ask / deny 都不计数，并清空连续段', () => {
    const state = createFenceRuleState();
    evaluateAuditEvent(silentAllow('2026-11-12T10:00:00.000Z'), state, CONFIG);
    evaluateAuditEvent(silentAllow('2026-11-12T10:00:01.000Z'), state, CONFIG);

    // 有命中规则的 allow（riskLevel 仍为 high）⇒ 不属于"空转"
    evaluateAuditEvent(
      event({
        timestamp: '2026-11-12T10:00:02.000Z',
        riskLevel: 'high',
        matchedRulesCount: 1,
      }),
      state,
      CONFIG
    );
    // 连续段被清空 ⇒ 再两次也不告警
    expect(
      evaluateAuditEvent(silentAllow('2026-11-12T10:00:03.000Z'), state, CONFIG)
    ).toEqual([]);
    expect(
      evaluateAuditEvent(silentAllow('2026-11-12T10:00:04.000Z'), state, CONFIG)
    ).toEqual([]);
  });
});

describe('M2 / S2 deny 后重试', () => {
  it('同命令（空白归一后）在窗口内再次出现 ⇒ 告警', () => {
    const state = createFenceRuleState();
    expect(
      evaluateAuditEvent(
        event({
          timestamp: '2026-11-12T10:00:00.000Z',
          command: 'rm -rf /tmp/x',
          behavior: 'deny',
          riskLevel: 'high',
        }),
        state,
        CONFIG
      )
    ).toEqual([]);

    const retry = evaluateAuditEvent(
      event({
        timestamp: '2026-11-12T10:00:10.000Z',
        command: 'rm   -rf   /tmp/x',
        behavior: 'deny',
        riskLevel: 'high',
      }),
      state,
      CONFIG
    );
    expect(retry.map((f) => f.kind)).toEqual(['deny-retry']);
  });

  it('误报防护：窗口外 / 不同命令 / 无 deny 都不告警', () => {
    const state = createFenceRuleState();
    evaluateAuditEvent(
      event({
        timestamp: '2026-11-12T10:00:00.000Z',
        command: 'rm -rf /tmp/x',
        behavior: 'deny',
      }),
      state,
      CONFIG
    );

    const outsideWindow = evaluateAuditEvent(
      event({
        timestamp: '2026-11-12T10:05:00.000Z',
        command: 'rm -rf /tmp/x',
      }),
      state,
      CONFIG
    );
    expect(outsideWindow).toEqual([]);

    const otherCommand = evaluateAuditEvent(
      event({ timestamp: '2026-11-12T10:00:10.000Z', command: 'echo hi' }),
      state,
      CONFIG
    );
    expect(otherCommand).toEqual([]);
  });
});

/**
 * 2026-11-13（G4 观察期 A + C）：真机 12/12 S1 告警全部是 grep/dir/type/todo_write 的
 * 只读默认放行（`dev_docs/20261112/G4-围栏工程形态设计-20261112.md` §10.7）。
 *
 * A：`riskLevel=high` 同时承载「deny」与「无规则默认放行」⇒ 必须叠加 `commandClass`；
 * C：阈值 5→10 + 同一命令 10 分钟去重。
 */
describe('M2 / S1 误报治理（2026-11-13 A + C）', () => {
  const DEDUP_CONFIG: FenceRuleConfig = {
    silentAllowRunLength: 3,
    silentAllowDedupWindowMs: 10 * 60_000,
    denyRetryWindowMs: 60_000,
  };

  /** `mm:ss`（同一天内单调递增，便于构造去重窗口边界） */
  const ts = (minute: number, second = 0): string =>
    `2026-11-12T10:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.000Z`;

  function uncovered(
    timestamp: string,
    command: string,
    extra: Partial<FenceAuditEvent> = {}
  ): FenceAuditEvent {
    return event({
      timestamp,
      command,
      behavior: 'allow',
      riskLevel: 'high',
      matchedRulesCount: 0,
      ruleCoverage: 'uncovered',
      ...extra,
    });
  }

  /** 依次喂入 N 条事件，返回累计告警 */
  function collect(
    count: number,
    make: (i: number) => FenceAuditEvent,
    state = createFenceRuleState(),
    config: FenceRuleConfig = DEDUP_CONFIG
  ): string[] {
    const kinds: string[] = [];
    for (let i = 0; i < count; i++) {
      kinds.push(
        ...evaluateAuditEvent(make(i), state, config).map((f) => f.kind)
      );
    }
    return kinds;
  }

  it('A 正向：只读 / 非 shell 的未覆盖放行不计入 S1（真机误报场景）', () => {
    for (const commandClass of ['read-only', 'non-shell'] as const) {
      expect(
        collect(
          10,
          (i) => uncovered(ts(0, i), 'grep', { commandClass }),
          createFenceRuleState(),
          { ...DEDUP_CONFIG, silentAllowRunLength: 3 }
        )
      ).toEqual([]);
    }
  });

  it('A 负向对照：write-or-exec 的未覆盖放行仍告警（规则不能被静音）', () => {
    expect(
      collect(3, (i) =>
        uncovered(ts(0, i), 'bun test', { commandClass: 'write-or-exec' })
      )
    ).toEqual(['silent-allow-streak']);
  });

  it('A 兼容：老审计行（无 commandClass / ruleCoverage）保持原行为', () => {
    expect(
      collect(3, (i) =>
        event({
          timestamp: ts(0, i),
          command: 'ls',
          behavior: 'allow',
          riskLevel: 'high',
          matchedRulesCount: 0,
        })
      )
    ).toEqual(['silent-allow-streak']);
  });

  it('A：ruleCoverage=matched 时即使 high + 无规则也不计入（结构化优先）', () => {
    expect(
      collect(3, (i) =>
        uncovered(ts(0, i), 'bun x', {
          commandClass: 'write-or-exec',
          ruleCoverage: 'matched',
        })
      )
    ).toEqual([]);
  });

  it('C：默认阈值 10 —— 前 9 次不告警，第 10 次告警', () => {
    const state = createFenceRuleState();
    const config: FenceRuleConfig = {
      ...DEDUP_CONFIG,
      silentAllowRunLength: 10,
    };
    for (let i = 0; i < 9; i++) {
      expect(
        evaluateAuditEvent(
          uncovered(ts(0, i), 'bun x', { commandClass: 'write-or-exec' }),
          state,
          config
        )
      ).toEqual([]);
    }
    const tenth = evaluateAuditEvent(
      uncovered(ts(0, 9), 'bun x', { commandClass: 'write-or-exec' }),
      state,
      config
    );
    expect(tenth.map((f) => f.kind)).toEqual(['silent-allow-streak']);
  });

  it('C：同一命令 10 分钟内去重；不同命令 / 窗口外仍告警', () => {
    const state = createFenceRuleState();
    const make =
      (minute: number, command: string) =>
      (i: number): FenceAuditEvent =>
        uncovered(ts(minute, i), command, { commandClass: 'write-or-exec' });

    // 第 1 个连续段 ⇒ 1 条告警
    expect(collect(3, make(0, 'bun x'), state)).toEqual([
      'silent-allow-streak',
    ]);
    // 同命令、10 分钟内再次命中 ⇒ 去重（不写告警）
    expect(collect(3, make(1, 'bun x'), state)).toEqual([]);
    // 不同命令 ⇒ 照常告警
    expect(collect(3, make(2, 'bun y'), state)).toEqual([
      'silent-allow-streak',
    ]);
    // 超过窗口（10:13 > 10:00 + 10min）⇒ 同命令重新告警
    expect(collect(3, make(13, 'bun x'), state)).toEqual([
      'silent-allow-streak',
    ]);
  });
});
