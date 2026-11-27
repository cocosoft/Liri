// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * D3 三期：`PdcaLaunchCoordinator.resumePlan` —— 系统级续跑的装配闸门。
 *
 * 语义：
 * - 未装配 launcher / 会话已有 launch 在途 ⇒ **不启动**（返回 false，由调用方回退消息注入）；
 * - 成功启动 ⇒ 把 `resumePlanId` 透传给 `PdcaLauncher.launch`（PDL 据此采纳既有计划）；
 * - 启动锁在 promise settle 后释放（无论成功/失败）。
 */

import { describe, expect, it } from 'bun:test';
import {
  PdcaLaunchCoordinator,
  type PdcaLaunchDeps,
} from '../../src/chat/manager/pdcaLaunch';
import type { PdcaLauncher } from '../../src/chat/launchers/PdcaLauncher';
import { ChatManagerImpl } from '../../src/chat/ChatManager';

type LaunchArgs = unknown[];

function makeDeps(options: { launcher: 'none' | 'ok'; busy?: boolean }): {
  deps: PdcaLaunchDeps;
  calls: LaunchArgs[];
  launchingSessions: Set<string>;
} {
  const launchingSessions = new Set<string>();
  if (options.busy) launchingSessions.add('sess_1');
  const calls: LaunchArgs[] = [];
  const launch = async (...args: LaunchArgs): Promise<void> => {
    calls.push(args);
  };
  const deps: PdcaLaunchDeps = {
    launchingSessions,
    getPdcaLauncher: () =>
      options.launcher === 'ok'
        ? ({ launch } as unknown as PdcaLauncher)
        : null,
    shouldUsePlanDrivenLoop: () => true,
    shouldUseCodeMode: () => false,
    appendStreamEvent: async () => ({}),
    persistSessionMetadata: async () => {},
    recentUserText: () => '',
  };
  return { deps, calls, launchingSessions };
}

describe('PdcaLaunchCoordinator.resumePlan（D3 三期）', () => {
  it('launcher 未装配 ⇒ false，不启动', () => {
    const { deps, calls } = makeDeps({ launcher: 'none' });
    const coordinator = new PdcaLaunchCoordinator(deps);
    expect(
      coordinator.resumePlan({
        sessionId: 'sess_1',
        planId: 'plan_a',
        description: '目标',
      })
    ).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('会话已有 launch 在途 ⇒ false（防重复接管）', () => {
    const { deps, calls } = makeDeps({ launcher: 'ok', busy: true });
    const coordinator = new PdcaLaunchCoordinator(deps);
    expect(
      coordinator.resumePlan({
        sessionId: 'sess_1',
        planId: 'plan_a',
        description: '目标',
      })
    ).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('成功 ⇒ 透传 resumePlanId，且锁在 settle 后释放', async () => {
    const { deps, calls, launchingSessions } = makeDeps({ launcher: 'ok' });
    const coordinator = new PdcaLaunchCoordinator(deps);

    expect(
      coordinator.resumePlan({
        sessionId: 'sess_1',
        planId: 'plan_a',
        description: '目标描述',
      })
    ).toBe(true);

    expect(calls).toHaveLength(1);
    const args = calls[0];
    expect(args[0]).toBe('');
    expect(args[1]).toBe('目标描述');
    expect(args[2]).toBe('sess_1');
    expect(args[4]).toBe(true);
    expect(args[5]).toEqual({ resumePlanId: 'plan_a' });

    // 启动期加锁（防同会话并发接管）
    expect(launchingSessions.has('sess_1')).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(launchingSessions.has('sess_1')).toBe(false);
  });
});

/**
 * 2026-11-19（真机验证发现）：recovery 曾从"纯访问器 deps 对象"上读 `_pdcaLaunch`
 * （该对象由 `buildChatManagerHelpers` 构造，不含此字段）⇒ 恒 undefined ⇒
 * `PLAN_SYSTEM_RESUME` 默认开也**从未**真正启动系统级续跑，一直静默回退消息注入。
 * 本用例锁死"宿主把协调器经访问器交给 recovery"这条接线。
 */
describe('ChatManager → ChatRecovery 的系统级续跑接线', () => {
  it('recovery 的 deps 能取到宿主的 _pdcaLaunch（同一实例）', () => {
    const cm = new ChatManagerImpl();
    try {
      const helpers = (
        cm as unknown as {
          _helpers: {
            recovery: { deps: { getPdcaLaunch?: () => unknown } };
          };
          _pdcaLaunch?: unknown;
        }
      )._helpers;
      const getPdcaLaunch = helpers.recovery.deps.getPdcaLaunch;
      expect(typeof getPdcaLaunch).toBe('function');
      const launch = (cm as unknown as { _pdcaLaunch?: unknown })._pdcaLaunch;
      expect(launch).toBeDefined();
      expect(getPdcaLaunch!()).toBe(launch);
    } finally {
      cm.cleanup();
    }
  });
});
