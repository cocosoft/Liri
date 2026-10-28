/**
 * 命令权限元数据 + 冲突策略（方案 §8.4「顺序红线」，P4-2，2026-10-28）
 *
 * 背景：命令此前**一个权限元数据都没有**，同名注册是 `Map.set` **静默覆盖**
 * （"谁的实现生效"取决于加载顺序，且无任何观测）。在开放外部注册之前必须先补：
 *   ① `onConflict = error`；② `source: builtin | plugin`；③ `plugin` 默认需要审批。
 *
 * 本用例把三条都钉死（含**负向**：冲突必须被拒、不得覆盖）。
 */
import { beforeEach, describe, expect, it } from 'bun:test';

import { CommandRegistry } from '../../src/commands/registry/CommandRegistry';
import type { Command } from '../../src/commands/types/index';

function makeCommand(name: string, overrides: Partial<Command> = {}): Command {
  return {
    type: 'action',
    name,
    description: `${name} test command`,
    ...overrides,
  };
}

describe('CommandRegistry 冲突策略（onConflict=error）', () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
  });

  it('同名 + **不同所有者** ⇒ 拒绝登记，保留已注册实现', () => {
    const builtin = makeCommand('deploy', { loadedFrom: 'builtin' });
    const plugin = makeCommand('deploy', { loadedFrom: 'plugin' });

    expect(registry.register(builtin)).toBe(true);
    expect(registry.register(plugin)).toBe(false);
    expect(registry.getCommand('deploy')).toBe(builtin);
  });

  it('同名 + **双方都未声明 loadedFrom** ⇒ 视为不同所有者 ⇒ 拒绝（不得静默覆盖）', () => {
    const first = makeCommand('deploy');
    const second = makeCommand('deploy');

    expect(registry.register(first)).toBe(true);
    expect(registry.register(second)).toBe(false);
    expect(registry.getCommand('deploy')).toBe(first);
  });

  it('同名 + **同一加载器** ⇒ 幂等重载：覆盖旧实例', () => {
    const oldImpl = makeCommand('deploy', { loadedFrom: 'builtin' });
    const newImpl = makeCommand('deploy', { loadedFrom: 'builtin' });

    expect(registry.register(oldImpl)).toBe(true);
    expect(registry.register(newImpl)).toBe(true);
    expect(registry.getCommand('deploy')).toBe(newImpl);
  });

  it('别名被他人占用 ⇒ 拒绝该别名，但不影响命令本体登记', () => {
    registry.register(makeCommand('status', { loadedFrom: 'builtin' }));
    registry.register(
      makeCommand('st', { loadedFrom: 'builtin', aliases: ['status'] })
    );

    // 别名指向原命令，未被覆盖
    expect(registry.getCommand('status')?.name).toBe('status');
    // 命令本体仍登记成功
    expect(registry.getCommand('st')?.name).toBe('st');
  });

  it('别名与已注册命令同名 ⇒ 拒绝该别名（避免"别名解析到别人的实现"）', () => {
    registry.register(makeCommand('status', { loadedFrom: 'builtin' }));
    registry.register(
      makeCommand('stat', { loadedFrom: 'builtin', aliases: ['status'] })
    );

    expect(registry.getCommand('status')?.name).toBe('status');
  });

  it('空名 ⇒ 拒绝（不进入注册表）', () => {
    expect(registry.register(makeCommand(''))).toBe(false);
    expect(registry.getCommandCount()).toBe(0);
  });
});

describe('CommandRegistry 权限元数据（§8.4）', () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
  });

  it('`source` 缺省 ⇒ `builtin`；显式 `plugin` ⇒ 原样返回', () => {
    registry.register(makeCommand('help', { loadedFrom: 'builtin' }));
    registry.register(
      makeCommand('ext.cmd', { loadedFrom: 'plugin', source: 'plugin' })
    );

    expect(registry.getCommandSource('help')).toBe('builtin');
    expect(registry.getCommandSource('ext.cmd')).toBe('plugin');
  });

  it('`plugin` 未声明 requiresApproval ⇒ **默认需要审批**（fail-closed）', () => {
    registry.register(
      makeCommand('ext.cmd', { loadedFrom: 'plugin', source: 'plugin' })
    );

    expect(registry.requiresApproval('ext.cmd')).toBe(true);
  });

  it('`builtin` 未声明 ⇒ 不需要审批；显式 `true` 仍生效', () => {
    registry.register(makeCommand('deploy', { loadedFrom: 'builtin' }));
    registry.register(
      makeCommand('danger', { loadedFrom: 'builtin', requiresApproval: true })
    );

    expect(registry.requiresApproval('deploy')).toBe(false);
    expect(registry.requiresApproval('danger')).toBe(true);
  });

  it('显式 `requiresApproval: false` 覆盖 plugin 默认值（有意识放行）', () => {
    registry.register(
      makeCommand('ext.cmd', {
        loadedFrom: 'plugin',
        source: 'plugin',
        requiresApproval: false,
      })
    );

    expect(registry.requiresApproval('ext.cmd')).toBe(false);
  });

  it('别名同样能解析到权限元数据（授权判定不应因别名而失真）', () => {
    registry.register(
      makeCommand('ext.cmd', {
        loadedFrom: 'plugin',
        source: 'plugin',
        aliases: ['ext'],
      })
    );

    expect(registry.requiresApproval('ext')).toBe(true);
  });
});
