// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * LRO-13（2026-10-26）：**阻塞命令台账**纯函数守卫。
 *
 * 语义：同一 `(命令, cwd, 策略版本)` 一旦被安全门判定不可执行，续跑时**直接短路**，
 * 不再重放同一堵墙。本文件只测纯函数（判定/键/裁剪/恢复），接线由
 * `lroBlockedCommandReplay.test.ts` 覆盖。
 */
import { describe, it, expect } from 'bun:test';
import {
  BLOCKED_COMMAND_MAX_ENTRIES,
  blockedCommandKey,
  blockedReplayResult,
  findBlockedReplay,
  isCommandTool,
  makeBlockedCommandEntry,
  normalizeBlockedCommand,
  pushBlockedCommand,
  readCommandFromArgs,
  removeBlockedCommand,
  restoreBlockedCommands,
  type BlockedCommandEntry,
} from '../../src/tasks/lro/blockedCommandLedger.js';

const INTERCEPTED = {
  success: false,
  error: 'bash: security_gate_blocked',
  metadata: { securityIntercepted: true, reason: 'path_safety' },
};

/** 造一条台账（默认策略版本 v1、cwd /work） */
function entry(
  overrides: Partial<BlockedCommandEntry> = {}
): BlockedCommandEntry {
  const base = {
    toolName: 'bash',
    command: 'echo /etc/passwd',
    cwd: '/work',
    policyVersion: 'v1',
    reason: 'path_safety',
    recordedAt: 1,
    ...overrides,
  };
  return { key: blockedCommandKey(base), ...base };
}

describe('LRO-13：命令规范化与键', () => {
  it('规范化只折叠空白（不改变大小写与内容）', () => {
    expect(normalizeBlockedCommand('  echo   /etc/passwd ')).toBe(
      'echo /etc/passwd'
    );
    expect(normalizeBlockedCommand('Echo\tA')).toBe('Echo A');
  });

  it('空白差异 ⇒ 同键；cwd / 策略版本 / 工具差异 ⇒ 不同键', () => {
    const base = {
      toolName: 'bash',
      command: 'echo /etc/passwd',
      cwd: '/work',
      policyVersion: 'v1',
    };
    expect(blockedCommandKey({ ...base, command: 'echo   /etc/passwd' })).toBe(
      blockedCommandKey(base)
    );
    expect(blockedCommandKey({ ...base, cwd: '/other' })).not.toBe(
      blockedCommandKey(base)
    );
    expect(blockedCommandKey({ ...base, policyVersion: 'v2' })).not.toBe(
      blockedCommandKey(base)
    );
    expect(blockedCommandKey({ ...base, toolName: 'powershell' })).not.toBe(
      blockedCommandKey(base)
    );
  });

  it('只有命令类工具参与；非命令工具或空命令 ⇒ 不读数', () => {
    expect(isCommandTool('bash')).toBe(true);
    expect(isCommandTool('powershell')).toBe(true);
    expect(isCommandTool('file_write')).toBe(false);
    expect(readCommandFromArgs({ command: 'ls -la' })).toBe('ls -la');
    expect(readCommandFromArgs({ command: '   ' })).toBeUndefined();
    expect(readCommandFromArgs({ path: '/tmp/a' })).toBeUndefined();
  });
});

describe('LRO-13：入账门槛（只认安全门显式拦截）', () => {
  it('bash + securityIntercepted ⇒ 入账，reason 取 metadata.reason', () => {
    const e = makeBlockedCommandEntry({
      toolName: 'bash',
      args: { command: '  echo   /etc/passwd ' },
      cwd: '/work',
      policyVersion: 'v1',
      result: INTERCEPTED,
      taskId: 't1',
      now: 42,
    });
    expect(e).toBeDefined();
    expect(e?.command).toBe('echo /etc/passwd');
    expect(e?.reason).toBe('path_safety');
    expect(e?.taskId).toBe('t1');
    expect(e?.recordedAt).toBe(42);
  });

  // 2026-11-08（真机 pdca_mw6yabdj）：ask 不是"已判定不可执行" —— 入账会让批准后的
  // 原样重放先撞 [BLOCKED_REPLAY]，模型被迫改写成等价命令 ⇒ 又命中新审批指纹。
  it('等人工审批（requireApproval）⇒ 不入账（批准后应允许原样重放）', () => {
    expect(
      makeBlockedCommandEntry({
        toolName: 'bash',
        args: { command: 'node -e "console.log(11)"' },
        cwd: '/work',
        policyVersion: 'v1',
        result: {
          success: false,
          error: '需要用户确认: 命令不在已知安全列表',
          requireApproval: true,
          metadata: {
            securityIntercepted: true,
            reason: 'security_analyzer_ask',
          },
        },
      })
    ).toBeUndefined();
  });

  it('普通工具报错（无拦截标记）⇒ 不入账（重放有意义）', () => {
    expect(
      makeBlockedCommandEntry({
        toolName: 'bash',
        args: { command: 'ls /nope' },
        cwd: '/work',
        policyVersion: 'v1',
        result: { success: false, error: 'No such file' },
      })
    ).toBeUndefined();
  });

  it('非命令工具 / 缺命令 ⇒ 不入账', () => {
    expect(
      makeBlockedCommandEntry({
        toolName: 'file_write',
        args: { path: '/etc/x' },
        cwd: '/work',
        policyVersion: 'v1',
        result: INTERCEPTED,
      })
    ).toBeUndefined();
    expect(
      makeBlockedCommandEntry({
        toolName: 'bash',
        args: {},
        cwd: '/work',
        policyVersion: 'v1',
        result: INTERCEPTED,
      })
    ).toBeUndefined();
  });
});

describe('LRO-13：短路查询（策略版本变化即失效）', () => {
  it('同命令同目录同版本（空白不同）⇒ 命中并返回既有结论', () => {
    const hit = findBlockedReplay([entry()], {
      toolName: 'bash',
      args: { command: 'echo  /etc/passwd' },
      cwd: '/work',
      policyVersion: 'v1',
    });
    expect(hit?.reason).toBe('path_safety');
  });

  it('策略版本变化 ⇒ 不命中（策略放松后不得被旧结论封死）', () => {
    expect(
      findBlockedReplay([entry()], {
        toolName: 'bash',
        args: { command: 'echo /etc/passwd' },
        cwd: '/work',
        policyVersion: 'v2',
      })
    ).toBeUndefined();
  });

  it('cwd 不同 / 非命令工具 ⇒ 不命中', () => {
    expect(
      findBlockedReplay([entry()], {
        toolName: 'bash',
        args: { command: 'echo /etc/passwd' },
        cwd: '/other',
        policyVersion: 'v1',
      })
    ).toBeUndefined();
    expect(
      findBlockedReplay([entry()], {
        toolName: 'file_write',
        args: { command: 'echo /etc/passwd' },
        cwd: '/work',
        policyVersion: 'v1',
      })
    ).toBeUndefined();
  });
});

describe('LRO-13：台账裁剪与恢复', () => {
  it('同键覆盖（不重复累积），超出上限丢最旧', () => {
    const a = entry({ command: 'a' });
    const a2 = entry({
      command: 'a',
      reason: 'dangerous_command',
      recordedAt: 9,
    });
    const one = pushBlockedCommand([a], a2);
    expect(one).toHaveLength(1);
    expect(one[0]?.reason).toBe('dangerous_command');

    let many: BlockedCommandEntry[] = [];
    for (let i = 0; i < BLOCKED_COMMAND_MAX_ENTRIES + 5; i++) {
      many = pushBlockedCommand(many, entry({ command: `cmd-${i}` }));
    }
    expect(many).toHaveLength(BLOCKED_COMMAND_MAX_ENTRIES);
    // 保留最近：最后一条仍在，最早一条被丢
    expect(many[many.length - 1]?.command).toBe(
      `cmd-${BLOCKED_COMMAND_MAX_ENTRIES + 4}`
    );
    expect(many.some((e) => e.command === 'cmd-0')).toBe(false);
  });

  it('从 checkpoint 恢复：丢弃残缺项、非数组 ⇒ 空', () => {
    const restored = restoreBlockedCommands([
      {
        key: 'k1',
        toolName: 'bash',
        command: 'echo /etc/passwd',
        cwd: '/work',
        policyVersion: 'v1',
        reason: 'path_safety',
        recordedAt: 1,
      },
      { key: 'k2', toolName: 'bash', command: 'rm -rf /' },
      null,
      'garbage',
    ]);
    expect(restored).toHaveLength(1);
    expect(restored[0]?.key).toBe('k1');
    expect(restoreBlockedCommands(undefined)).toEqual([]);
    expect(restoreBlockedCommands({})).toEqual([]);
  });
});

describe('LRO-13：短路结果文案', () => {
  it('带 [BLOCKED_REPLAY] 标记 + 既有结论 + 不再重放指令', () => {
    const r = blockedReplayResult(entry(), { id: 'call-1', name: 'bash' });
    expect(r.toolCallId).toBe('call-1');
    expect(r.failureKind).toBe('safety_blocked');
    expect(r.error).toContain('[BLOCKED_REPLAY]');
    expect(r.error).toContain('path_safety');
    expect(r.error).toContain('不再重放');
  });
});

// 2026-11-08（真机 pdca_mw6m1mg8）：审批通过后必须解除台账，否则续跑仍 [BLOCKED_REPLAY]
describe('LRO-13：审批通过 ⇒ 解除该命令的台账结论', () => {
  it('按规范化命令移除（空白差异不影响）', () => {
    const entries = [
      entry({ command: 'node -e "console.log(1)"' }),
      entry({ command: 'echo other' }),
    ];
    const { next, removed } = removeBlockedCommand(
      entries,
      '  node   -e "console.log(1)" '
    );
    expect(removed).toBe(1);
    expect(next).toHaveLength(1);
    expect(next[0]?.command).toBe('echo other');
  });

  it('同命令不同 cwd 也一并解除（批准的是命令本身）', () => {
    const entries = [
      entry({ command: 'node a.js', cwd: '/work' }),
      entry({ command: 'node a.js', cwd: '/other' }),
    ];
    expect(removeBlockedCommand(entries, 'node a.js').removed).toBe(2);
  });

  it('空命令 / 不在台账 ⇒ 原样返回且 removed=0', () => {
    const entries = [entry()];
    expect(removeBlockedCommand(entries, '  ').removed).toBe(0);
    expect(removeBlockedCommand(entries, 'rm -rf /').next).toHaveLength(1);
  });
});
