// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * F2（2026-11-17）：暂停持久化放行的**工作区粒度**在「审批写入点」同样生效。
 *
 * 背景：判定口已能按工作区过滤审批规则，但写入点（`persistFingerprintRule` 等三处）
 * 只拿到 `sessionId`。若在此处不查工作区根，「工作区已暂停」时批准一张卡仍会静默攒下
 * 新放行规则 ⇒ 用户解开暂停后突然生效，与「暂停 = 不再新增放行」的承诺不符。
 *
 * 本文件锁两件事：
 * 1. `readSessionWorkspaceRoots` 如实取根（`metadata.workspaceRoots` + `workspacePath` 兜底，
 *    读不到 ⇒ `undefined`，**不编造**、不阻断写入）；
 * 2. 组合判定：取到的根 + 暂停配置 ⇒ `isApprovalPauseActiveFor` 命中（与 `approvalPause.ts`
 *    的单测共同覆盖写入点判定，避免在测试里重建整套 Inbox 链路）。
 */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { configManager, getConfigManager } from '@openliri/infra/config';
import { APPROVAL_PAUSE_CONFIG_KEY } from '@openliri/infra/permission/approvalPause';
import { isApprovalPauseActiveFor } from '@openliri/infra/permission/approvalPause';

import { registerRuntimeCoreApiProvider } from '@openliri/service/runtime/api/coreApiProvider';
import { readSessionWorkspaceRoots } from '@openliri/service/runtime/inboxApproval';

let configSpy: ReturnType<typeof spyOn> | undefined;

afterEach(() => {
  configSpy?.mockRestore();
  configSpy = undefined;
  registerRuntimeCoreApiProvider(undefined);
});

/** 让 chatManager.loadSession 返回给定会话 */
function stubSession(metadata: Record<string, unknown>): void {
  registerRuntimeCoreApiProvider(() => ({
    chatManager: {
      loadSession: async () => ({ metadata }),
    },
  }));
}

describe('F2：readSessionWorkspaceRoots（如实取根）', () => {
  it('合并 workspaceRoots 与绑定的 workspacePath，过滤非字符串/空值', async () => {
    stubSession({
      workspaceRoots: ['e:/a', '', 123, 'e:/b'],
      workspacePath: 'e:/bound',
    });
    expect(await readSessionWorkspaceRoots('sess-1')).toEqual([
      'e:/a',
      'e:/b',
      'e:/bound',
    ]);
  });

  it('loadSession 无结果 ⇒ 回落会话网关；仍无 ⇒ undefined', async () => {
    registerRuntimeCoreApiProvider(() => ({
      chatManager: {
        loadSession: async () => undefined,
        getSessionGateway: () => ({
          getSession: async () => ({ metadata: { workspacePath: 'e:/gw' } }),
          updateSession: async () => undefined,
        }),
      },
    }));
    expect(await readSessionWorkspaceRoots('sess-1')).toEqual(['e:/gw']);

    registerRuntimeCoreApiProvider(() => ({
      chatManager: {
        loadSession: async () => undefined,
        getSessionGateway: () => ({
          getSession: async () => undefined,
          updateSession: async () => undefined,
        }),
      },
    }));
    expect(await readSessionWorkspaceRoots('sess-1')).toBeUndefined();
  });

  it('无会话 id / 未注册组合根 / 读取抛错 ⇒ undefined（不编造、不抛出）', async () => {
    expect(await readSessionWorkspaceRoots(undefined)).toBeUndefined();

    registerRuntimeCoreApiProvider(undefined);
    expect(await readSessionWorkspaceRoots('sess-1')).toBeUndefined();

    registerRuntimeCoreApiProvider(() => ({
      chatManager: {
        loadSession: async () => {
          throw new Error('gateway down');
        },
      },
    }));
    expect(await readSessionWorkspaceRoots('sess-1')).toBeUndefined();
  });
});

describe('F2：取到的根 + 暂停配置 ⇒ 写入点应跳过', () => {
  it('工作区已在暂停列表（归一化比较）⇒ 判定为暂停', async () => {
    stubSession({ workspacePath: 'E:\\Proj\\' });
    configSpy = spyOn(getConfigManager(), 'getValue').mockImplementation(((
      key: string
    ) =>
      key === APPROVAL_PAUSE_CONFIG_KEY
        ? { global: false, sessions: [], workspaces: ['e:/proj'] }
        : undefined) as unknown as typeof configManager.getValue);

    const roots = await readSessionWorkspaceRoots('sess-1');
    expect(
      isApprovalPauseActiveFor({ sessionId: 'sess-1', workspaceRoots: roots })
    ).toBe(true);
    // 其他工作区不受影响
    expect(
      isApprovalPauseActiveFor({
        sessionId: 'sess-1',
        workspaceRoots: ['e:/other'],
      })
    ).toBe(false);
  });

  it('会话被暂停 ⇒ 无需读根也判定为暂停（写入点省一次 IO 的口径）', async () => {
    configSpy = spyOn(getConfigManager(), 'getValue').mockImplementation(((
      key: string
    ) =>
      key === APPROVAL_PAUSE_CONFIG_KEY
        ? { global: false, sessions: ['sess-1'], workspaces: [] }
        : undefined) as unknown as typeof configManager.getValue);

    expect(isApprovalPauseActiveFor({ sessionId: 'sess-1' })).toBe(true);
  });
});
