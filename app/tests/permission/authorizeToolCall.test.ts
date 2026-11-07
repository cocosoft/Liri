/**
 * P1「单一入口」（2026-11-03，`dev_docs/20261027/工具权限体系归一化方案-20261027.md` §5）守卫。
 *
 * 钉住两件事：
 * 1. `authorizeToolCall` 的归一化口径（allow / ask（已提交/未提交）/ deny + 结构化依据）；
 * 2. **HTTP/CoreAPI 路径的权限门**（B2）：未注入权限管理器 ⇒ fail-closed；
 *    ask ⇒ 不执行工具、如实回传待审批；deny ⇒ 不执行；allow ⇒ 才真正调用工具。
 */
import { describe, expect, it } from 'bun:test';

import {
  authorizeToolCall,
  type ToolPermissionPort,
  type ToolPermissionPortResult,
} from '@openliri/infra/permission';
import { SessionAgentOps } from '../../src/runtime/api/sessionAgentOps.js';

function portReturning(result: ToolPermissionPortResult): ToolPermissionPort {
  return { checkPermissionForTool: async () => result };
}

describe('authorizeToolCall 归一化', () => {
  it('允许 ⇒ { allowed: true }', async () => {
    const outcome = await authorizeToolCall(portReturning({ allowed: true }), {
      toolName: 'file_read',
      args: {},
    });
    expect(outcome.allowed).toBe(true);
  });

  it('ask（已提交 Inbox）⇒ kind=ask + inboxItemId + submittedToInbox=true', async () => {
    const outcome = await authorizeToolCall(
      portReturning({
        allowed: false,
        decision: { behavior: 'ask' },
        reason: '需要人工确认',
        submittedToInbox: true,
        inboxItemId: 'inbox-1',
        commandHash: 'hash-1',
      }),
      { toolName: 'bash', args: { command: 'rm -rf tmp' } }
    );
    expect(outcome.allowed).toBe(false);
    if (outcome.allowed || outcome.kind !== 'ask') throw new Error('应为 ask');
    expect(outcome.submittedToInbox).toBe(true);
    expect(outcome.inboxItemId).toBe('inbox-1');
    expect(outcome.commandHash).toBe('hash-1');
    expect(outcome.reason).toBe('需要人工确认');
  });

  it('ask（Inbox 不可用）⇒ submittedToInbox=false（上层据此报审批通道不可用）', async () => {
    const outcome = await authorizeToolCall(
      portReturning({
        allowed: false,
        decision: { behavior: 'ask' },
        reason: '审批通道不可用',
      }),
      { toolName: 'bash', args: {} }
    );
    if (outcome.allowed || outcome.kind !== 'ask') throw new Error('应为 ask');
    expect(outcome.submittedToInbox).toBe(false);
  });

  it('deny ⇒ kind=deny 且保留结构化依据', async () => {
    const denyInfo = { ruleId: 'rule-x', sourceKind: 'ruleStore' };
    const outcome = await authorizeToolCall(
      portReturning({
        allowed: false,
        decision: { behavior: 'deny' },
        reason: '被规则拒绝',
        denyInfo,
      }),
      { toolName: 'file_write', args: {} }
    );
    if (outcome.allowed || outcome.kind !== 'deny')
      throw new Error('应为 deny');
    expect(outcome.reason).toBe('被规则拒绝');
    expect(outcome.denyInfo).toEqual(denyInfo);
  });
});

describe('HTTP/CoreAPI 路径权限门（B2）', () => {
  const toolCall = {
    id: 'toolcall-1',
    name: 'file_write',
    arguments: { file_path: 'x.txt', content: 'hi' },
  };

  function makeOps(options: {
    permissionManager?: unknown;
    executed: string[];
    /** 工具自身返回值（默认成功；用于回放"安全闸要求审批"等真实形态） */
    toolResult?: unknown;
  }): SessionAgentOps {
    return new SessionAgentOps({
      getPermissionManager: () => options.permissionManager,
      getToolManager: () =>
        ({
          executeTool: async (name: string) => {
            options.executed.push(name);
            return options.toolResult ?? { success: true, output: 'ok' };
          },
        }) as never,
      getChatManager: () => ({}) as never,
      getSessionManager: () => ({}) as never,
      getSessionMessagesRead: () => ({}) as never,
      getMessageMutation: () => ({}) as never,
      getSessionTitling: () => ({}) as never,
      getCoordinator: () => ({}) as never,
      getConverterEngine: () => ({}) as never,
      getFileTypeDetector: () => ({}) as never,
    });
  }

  it('未注入权限管理器 ⇒ fail-closed，不执行工具', async () => {
    const executed: string[] = [];
    const ops = makeOps({ permissionManager: undefined, executed });
    const result = await ops.executeTool('session-1', toolCall);
    expect(executed).toEqual([]);
    expect(result.error).toContain('权限检查不可用');
  });

  it('deny ⇒ 不执行工具，回传 Permission denied', async () => {
    const executed: string[] = [];
    const ops = makeOps({
      permissionManager: portReturning({
        allowed: false,
        decision: { behavior: 'deny' },
        reason: '规则拒绝',
        denyInfo: { ruleId: 'rule-y' },
      }),
      executed,
    });
    const result = await ops.executeTool('session-1', toolCall);
    expect(executed).toEqual([]);
    expect(result.error).toContain('Permission denied');
  });

  it('ask ⇒ 不执行工具，回传 pendingApproval（审批卡由权限层提交）', async () => {
    const executed: string[] = [];
    const ops = makeOps({
      permissionManager: portReturning({
        allowed: false,
        decision: { behavior: 'ask' },
        reason: '需要批准',
        submittedToInbox: true,
        inboxItemId: 'inbox-2',
      }),
      executed,
    });
    const result = await ops.executeTool('session-1', toolCall);
    expect(executed).toEqual([]);
    expect(result.result).toMatchObject({
      pendingApproval: true,
      inboxItemId: 'inbox-2',
    });
    expect(result.error).toContain('需要用户批准');
  });

  it('allow ⇒ 正常执行工具（零行为变更）', async () => {
    const executed: string[] = [];
    const ops = makeOps({
      permissionManager: portReturning({ allowed: true }),
      executed,
    });
    const result = await ops.executeTool('session-1', toolCall);
    expect(executed).toEqual(['file_write']);
    expect(result.error).toBe(null);
  });

  it('工具级 requireApproval（安全闸）⇒ 不谎报成功，回传 pendingApproval + 无审批通道', async () => {
    const executed: string[] = [];
    const ops = makeOps({
      permissionManager: portReturning({ allowed: true }),
      executed,
      // 真机形态（2026-11-07）：bash 安全闸返回 success:true + requireApproval:true，
      // 命令实际**未执行**；HTTP 路径此前原样回 success:true（调用方误判已执行）。
      toolResult: {
        success: true,
        data: '需要用户确认: 命令不在已知安全列表',
        requireApproval: true,
        approvalReason: '命令不在已知安全列表',
      },
    });
    const result = await ops.executeTool('session-1', toolCall);
    expect(executed).toEqual(['file_write']);
    expect((result as { success?: boolean }).success).toBe(false);
    expect(result.result).toBe(null);
    expect(result.error).toContain('需要用户批准');
    expect(result.error).toContain('命令不在已知安全列表');
  });
});
