// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `applyToolPermissionGate` 的特征化测试（2026-11-17，T3 复杂度清理 stage 3）。
 *
 * 背景：`ToolExecutionService._executeInternal` 的「权限检查」整段（含 ask / deny /
 * 等审批 / 审批通道不可用四条出口）搬出为注入依赖的 `chat/services/permissionGate.ts`。
 * 本测试把四条出口与上下文透传口径钉住，供后续再拆分时对照。
 *
 * 手法：`spyOn` 权限层 `authorizeToolCall`（唯一判定入口）返回构造结论；其余依赖用最小桩。
 */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import * as permission from '@openliri/infra/permission';
import type { ToolPermissionPort } from '@openliri/infra/permission';
import * as notificationModule from '../../src/chat/services/EventNotificationService';
import {
  applyToolPermissionGate,
  type ToolPermissionGateDeps,
} from '../../src/chat/services/permissionGate';

const spies: Array<{ mockRestore: () => void }> = [];

function stubAuthorize(outcome: unknown) {
  const s = spyOn(permission, 'authorizeToolCall').mockResolvedValue(
    outcome as never
  );
  spies.push(s as unknown as { mockRestore: () => void });
  return s as unknown as { mock: { calls: unknown[][] } };
}

afterEach(() => {
  for (const s of spies.splice(0, spies.length)) s.mockRestore();
});

function makeDeps(
  overrides: Partial<ToolPermissionGateDeps> = {}
): ToolPermissionGateDeps {
  return {
    getPermissionManager: () =>
      ({
        checkPermissionForTool: async () => ({ allowed: true }),
      }) as ToolPermissionPort,
    resolveRegisteredTool: () => undefined,
    getSessionApprovalMode: () => 'ask',
    getSessionPermissionMode: () => undefined,
    getSessionWorkspacePath: () => '/ws',
    getSessionWorkspaceRoots: () => [],
    getSessionAutonomy: () => 'interactive',
    isCommandApproved: async () => false,
    workspaceRootsHint: () => '（可用根：/ws）',
    resolveNonIdempotentRetryReason: () => undefined,
    resolveIntentText: () => undefined,
    awaitingApprovalStatus: 'awaiting_approval',
    ...overrides,
  };
}

const toolCall = { id: 'call-1', name: 'file_write', sessionId: 'sess-1' };
const args = { path: '/ws/a.txt' };

describe('applyToolPermissionGate：权限闸门四条出口（特征化）', () => {
  it('① 允许（逐条批准）⇒ 放行且无自动放行标注', async () => {
    stubAuthorize({ allowed: true });

    const outcome = await applyToolPermissionGate({
      toolCall,
      args,
      deps: makeDeps(),
    });

    expect(outcome.result).toBeNull();
    expect(outcome.autoInfo).toBeUndefined();
  });

  it('① 允许（会话权限档自动放行）⇒ 回传来源编码', async () => {
    stubAuthorize({
      allowed: true,
      autoApproved: true,
      approvalSource: 'permission-mode:bypass',
    });

    const outcome = await applyToolPermissionGate({
      toolCall,
      args,
      deps: makeDeps(),
    });

    expect(outcome.result).toBeNull();
    expect(outcome.autoInfo).toEqual({
      autoApproved: true,
      approvalSource: 'permission-mode:bypass',
    });
  });

  it('① 判定上下文透传：会话 id / 工具名 / 工作区路径 / 默认审批模式 ask', async () => {
    const authorize = stubAuthorize({ allowed: true });

    await applyToolPermissionGate({ toolCall, args, deps: makeDeps() });

    const call = authorize.mock.calls[0]![1] as {
      toolName: string;
      context: Record<string, unknown>;
    };
    expect(call.toolName).toBe('file_write');
    expect(call.context).toMatchObject({
      sessionId: 'sess-1',
      toolCallId: 'call-1',
      approvalMode: 'ask',
      workspacePath: '/ws',
    });
  });

  it('② DENY ⇒ permission_denied + 结构化 denyInfo 进 metadata', async () => {
    stubAuthorize({
      allowed: false,
      kind: 'deny',
      reason: 'denied by rule',
      denyInfo: { ruleId: 'R-1' },
    });

    const outcome = await applyToolPermissionGate({
      toolCall,
      args,
      deps: makeDeps(),
    });

    expect(outcome.result).toMatchObject({
      toolCallId: 'call-1',
      failureKind: 'permission_denied',
      metadata: { permissionDeny: { ruleId: 'R-1' } },
    });
    expect(String(outcome.result?.error)).toContain('Permission denied');
  });

  it('③ ask 但命中「已批准」⇒ 放行继续执行', async () => {
    stubAuthorize({
      allowed: false,
      kind: 'ask',
      reason: 'need approval',
      submittedToInbox: true,
    });

    const outcome = await applyToolPermissionGate({
      toolCall,
      args,
      deps: makeDeps({ isCommandApproved: async () => true }),
    });

    expect(outcome.result).toBeNull();
  });

  it('③ ask 未批准 + 已提交 Inbox ⇒ 返回等审批结果并广播 tool:completed', async () => {
    stubAuthorize({
      allowed: false,
      kind: 'ask',
      reason: 'need approval',
      submittedToInbox: true,
      inboxItemId: 'inbox-9',
    });
    const emit = spyOn(
      notificationModule.eventNotificationService,
      'emitCustomEvent'
    ).mockImplementation((() => {}) as never) as unknown as {
      mock: { calls: unknown[][] };
      mockRestore: () => void;
    };
    spies.push(emit);

    const outcome = await applyToolPermissionGate({
      toolCall,
      args,
      deps: makeDeps(),
    });

    expect(outcome.result).toMatchObject({
      result: {
        status: 'awaiting_approval',
        pendingApproval: true,
        inboxId: 'inbox-9',
      },
    });
    expect(emit.mock.calls[0]![0]).toBe('tool:completed');
  });

  it('③ ask 未批准 + 审批通道不可用 ⇒ 显式报错（非静默等待）', async () => {
    stubAuthorize({
      allowed: false,
      kind: 'ask',
      reason: 'inbox down',
      submittedToInbox: false,
    });

    const outcome = await applyToolPermissionGate({
      toolCall,
      args,
      deps: makeDeps(),
    });

    expect(String(outcome.result?.error)).toContain('审批通道不可用');
    expect(outcome.result).toMatchObject({
      failureKind: 'permission_denied',
      metadata: { approvalChannelDown: true },
    });
  });

  it('④ 权限管理器未注入（测试环境 fail-open）⇒ 放行', async () => {
    const outcome = await applyToolPermissionGate({
      toolCall,
      args,
      deps: makeDeps({ getPermissionManager: () => undefined }),
    });

    expect(outcome.result).toBeNull();
  });
});
