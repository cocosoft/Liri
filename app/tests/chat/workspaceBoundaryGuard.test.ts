// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `guardWorkspaceBoundary` 的特征化测试（2026-11-17，T3 复杂度清理 stage 6）。
 *
 * 背景：`ToolExecutionService._executeInternal` 的「工作区严格边界」整段搬出为
 * `chat/services/workspaceBoundaryGuard.ts`（含三个越界文案纯函数）。
 *
 * 钉住的行为（`FEATURE_WORKSPACE_MULTI_ROOT` 默认关 ⇒ 单根口径）：
 *  ① 未启用严格边界 / 无会话工作区 ⇒ 放行；
 *  ② 严格边界内路径 ⇒ 放行；
 *  ③ 越界 + 根可用 ⇒ 拒绝，`failureKind: permission_denied`，文案含「路径越界」与可访问根；
 *  ④ 越界 + 根已失效 ⇒ `env_unavailable`（fail-fast）且文案含「工作区已失效」。
 */
import { describe, expect, it } from 'bun:test';
import { tmpdir } from 'node:os';

import { guardWorkspaceBoundary } from '../../src/chat/services/workspaceBoundaryGuard';

const realRoot = tmpdir();

describe('guardWorkspaceBoundary：严格边界守卫（特征化）', () => {
  it('① 未启用严格边界 ⇒ 放行', async () => {
    const result = await guardWorkspaceBoundary({
      toolCall: { id: 'c1', name: 'file_read', sessionId: 's1' },
      args: { file_path: '/outside/x.txt' },
      sessionWorkspacePath: realRoot,
      deps: {
        isSessionWorkspaceStrict: () => false,
        requestWorkspaceScopeApproval: async () => false,
      },
    });

    expect(result).toBeNull();
  });

  it('① 无会话工作区 ⇒ 放行', async () => {
    const result = await guardWorkspaceBoundary({
      toolCall: { id: 'c2', name: 'file_read', sessionId: 's2' },
      args: { file_path: '/outside/x.txt' },
      sessionWorkspacePath: undefined,
      deps: {
        isSessionWorkspaceStrict: () => true,
        requestWorkspaceScopeApproval: async () => false,
      },
    });

    expect(result).toBeNull();
  });

  it('② 工作区内的相对路径 ⇒ 放行', async () => {
    const result = await guardWorkspaceBoundary({
      toolCall: { id: 'c3', name: 'file_read', sessionId: 's3' },
      args: { file_path: 'inside.txt' },
      sessionWorkspacePath: realRoot,
      deps: {
        isSessionWorkspaceStrict: () => true,
        requestWorkspaceScopeApproval: async () => false,
      },
    });

    expect(result).toBeNull();
  });

  it('③ 越界 + 根可用 ⇒ 拒绝（可恢复分型），文案给出可访问根', async () => {
    const result = await guardWorkspaceBoundary({
      toolCall: { id: 'c4', name: 'file_read', sessionId: 's4' },
      args: { file_path: '/definitely-outside-of-workspace/x.txt' },
      sessionWorkspacePath: realRoot,
      deps: {
        isSessionWorkspaceStrict: () => true,
        requestWorkspaceScopeApproval: async () => false,
      },
    });

    expect(result).toMatchObject({
      toolCallId: 'c4',
      toolName: 'file_read',
      result: null,
    });
    // 分型随 `FEATURE_WORKSPACE_MULTI_ROOT` 灰度（关闭 ⇒ permission_denied；
    // 开启 ⇒ workspace_escape / *_pending_approval）—— 三者均为"可告知模型改道"的拒绝态。
    expect([
      'permission_denied',
      'workspace_escape',
      'workspace_escape_pending_approval',
    ]).toContain(result?.failureKind as string);
    expect(String(result?.error)).toContain('路径越界');
    expect(String(result?.error)).toContain(realRoot);
  });

  it('④ 越界 + 根已失效 ⇒ env_unavailable（fail-fast）', async () => {
    const deadRoot = '/definitely-missing-workspace-root-xyz';

    const result = await guardWorkspaceBoundary({
      toolCall: { id: 'c5', name: 'file_read', sessionId: 's5' },
      args: { file_path: '/definitely-outside-of-workspace/y.txt' },
      sessionWorkspacePath: deadRoot,
      deps: {
        isSessionWorkspaceStrict: () => true,
        requestWorkspaceScopeApproval: async () => false,
      },
    });

    expect(result).toMatchObject({
      failureKind: 'env_unavailable',
      result: null,
    });
    expect(String(result?.error)).toContain('工作区已失效');
  });
});
