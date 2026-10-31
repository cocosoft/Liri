/**
 * P3（2026-10-30）：命令顶层收敛 —— 分组表与加载器隐藏口径
 *
 * 契约（用户裁定）：
 * - 顶层 = 8 个分组父命令 + 16 个独立保留（`KEEP_TOP_LEVEL`）共 **24** 个；
 * - 其余命令**仍注册、仍可执行**，只是 `isHidden: true`（不进 `/help` 与补全）；
 * - 每个隐藏命令要么能经「`/分组 <子命令>`」到达，要么在 `HIDDEN_ONLY` 里给出理由；
 * - 分组改写只认表内子命令（父命令自身的 `status`/`branch` 等语义不被改写）。
 */
import { describe, expect, it } from 'bun:test';

import {
  COMMAND_GROUPS,
  HIDDEN_ONLY,
  KEEP_TOP_LEVEL,
  getVisibleTopLevelNames,
  isVisibleTopLevel,
  resolveGroupDelegation,
} from '../../src/commands/groups/commandGroups';
import { BuiltinCommandLoader } from '../../src/commands/loader/CommandLoader';
import { formatGroupHelp } from '../../src/commands/groups/groupCommands';

const loader = new BuiltinCommandLoader();
const commands = await loader.loadCommands();
const names = commands.map((c) => c.name);
const nameSet = new Set(names);
const visible = getVisibleTopLevelNames();
const delegatedTargets = new Set(
  Object.values(COMMAND_GROUPS).flatMap((g) => Object.values(g.subcommands))
);

describe('顶层清单（27 个）', () => {
  it('= 9 个分组父命令 + 18 个独立保留（含 prompt 型 3 个）', () => {
    expect(Object.keys(COMMAND_GROUPS).sort()).toEqual([
      'config',
      'diagnose',
      'git',
      'help',
      'media',
      'session',
      'setup',
      'usage',
      'work',
    ]);
    expect(KEEP_TOP_LEVEL.length).toBe(19);
    // 集合去重（help 同时是父命令与保留项）
    expect(visible.size).toBe(27);
  });

  it('可见名全部已注册（拼错 ⇒ 顶层出现空位）', () => {
    const missing = [...visible].filter((n) => !nameSet.has(n));
    expect(missing).toEqual([]);
  });

  it('分组子命令的目标全部已注册，且不是分组父命令（防递归）', () => {
    const missing = [...delegatedTargets].filter((n) => !nameSet.has(n));
    expect(missing).toEqual([]);
    const selfRefs = [...delegatedTargets].filter((n) => n in COMMAND_GROUPS);
    expect(selfRefs).toEqual([]);
  });
});

describe('2026-10-31：8 个"定义了但从未注册"的命令已接线', () => {
  const WIRED = [
    'balance',
    'usagestats',
    'provider',
    'backup',
    'logs',
    'stats',
    'migrate',
    'channel',
  ];

  it('全部已注册，且一律隐藏（不新增顶层面）', () => {
    expect(WIRED.filter((n) => !nameSet.has(n))).toEqual([]);
    for (const name of WIRED) expect(isVisibleTopLevel(name)).toBe(false);
  });

  it('除刻意不设第二处入口的 channel 外，都可经分组到达', () => {
    expect(resolveGroupDelegation('usage', 'balance')).toEqual({
      name: 'balance',
      args: '',
    });
    expect(resolveGroupDelegation('usage', 'stats')).toEqual({
      name: 'usagestats',
      args: '',
    });
    expect(resolveGroupDelegation('setup', 'provider')).toEqual({
      name: 'provider',
      args: '',
    });
    expect(resolveGroupDelegation('setup', 'backup')).toEqual({
      name: 'backup',
      args: '',
    });
    expect(resolveGroupDelegation('setup', 'migrate')).toEqual({
      name: 'migrate',
      args: '',
    });
    expect(resolveGroupDelegation('diagnose', 'logs')).toEqual({
      name: 'logs',
      args: '',
    });
    expect(resolveGroupDelegation('diagnose', 'stats')).toEqual({
      name: 'stats',
      args: '',
    });
    // `channel` 与 `/gateway` 同源重复 ⇒ 只登记理由，不做第二处入口
    expect(HIDDEN_ONLY.channel).toContain('/gateway');
  });
});

describe('隐藏口径：不删、不丢、可达', () => {
  it('加载器把非顶层命令标记为隐藏（顶层全部可见）', () => {
    for (const cmd of commands) {
      expect(cmd.isHidden === true).toBe(!visible.has(cmd.name));
    }
  });

  it('每个隐藏命令都能经分组到达，或在 HIDDEN_ONLY 里登记理由', () => {
    const unreachable = names
      .filter((n) => !visible.has(n))
      .filter((n) => !delegatedTargets.has(n) && !(n in HIDDEN_ONLY))
      .sort();
    expect(unreachable).toEqual([]);
  });

  it('HIDDEN_ONLY 每项都有非空理由，且确实存在', () => {
    for (const [name, reason] of Object.entries(HIDDEN_ONLY)) {
      expect(reason.trim().length).toBeGreaterThan(0);
      expect(nameSet.has(name)).toBe(true);
      expect(isVisibleTopLevel(name)).toBe(false);
    }
  });

  it('工具影子命令一律隐藏（不再占据 /help 与补全）', () => {
    for (const name of ['bash', 'edit', 'write', 'glob', 'grep', 'todo']) {
      expect(isVisibleTopLevel(name)).toBe(false);
    }
  });
});

describe('分组改写（resolveGroupDelegation）', () => {
  it('命中子命令 ⇒ 改写成目标命令 + 剩余参数', () => {
    expect(resolveGroupDelegation('git', 'commit -m "x"')).toEqual({
      name: 'commit',
      args: '-m "x"',
    });
    expect(resolveGroupDelegation('usage', 'cost --today')).toEqual({
      name: 'cost',
      args: '--today',
    });
    expect(resolveGroupDelegation('diagnose', 'gateway')).toEqual({
      name: 'gateway',
      args: '',
    });
  });

  it('父命令自身的子命令 / 空参数 / 未知子命令 ⇒ 不改写（交给父命令实现）', () => {
    expect(resolveGroupDelegation('git', 'status')).toBeUndefined();
    expect(resolveGroupDelegation('session', 'list')).toBeUndefined();
    expect(resolveGroupDelegation('git', '')).toBeUndefined();
    expect(resolveGroupDelegation('usage', 'nope')).toBeUndefined();
    expect(resolveGroupDelegation('unknown_group', 'x')).toBeUndefined();
  });

  it('同一父命令内子命令名不重复（数据自洽）', () => {
    for (const [parent, group] of Object.entries(COMMAND_GROUPS)) {
      const subs = Object.keys(group.subcommands);
      expect(new Set(subs).size).toBe(subs.length);
      expect(parent.length).toBeGreaterThan(0);
    }
  });
});

describe('分组帮助输出（/分组 或 /分组 未知子命令）', () => {
  it('每个分组都列出全部子命令，且为纯文本（不含 markdown 加粗）', () => {
    for (const [parent, group] of Object.entries(COMMAND_GROUPS)) {
      const text = formatGroupHelp(parent);
      expect(text).toContain(`/${parent}`);
      for (const sub of Object.keys(group.subcommands)) {
        expect(text).toContain(sub);
      }
      expect(text).not.toContain('**');
    }
  });
});
