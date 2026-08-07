// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 工具执行审批链路 P2-3/P1-2 — ChatManager 权限三态化测试
 *
 * 覆盖（P0-2/P0-6/P1-2）：
 * - ask + submittedToInbox:true → 返回 awaiting_approval（非失败语义，pendingApproval:true）
 * - ask + submittedToInbox:false → Inbox 未提交，降级返回普通 ask 文本（P1-3）
 * - deny 决策 → 拦截（error 语义）
 * - allow 决策 → 放行继续执行（无 toolRegistry 时报执行错误，证明已通过权限层）
 * - ask + 放行缓存命中（session+hash）→ 跳过 ask 不弹卡，直接放行执行
 *
 * P1-2 统一提交后，ChatManager 不再自行提交审批卡片（提交由 PermissionChecker
 * _submitToInbox 负责），本测试仅 mock permissionManager 决策结果。
 */
import { describe, it, expect, beforeEach } from 'bun:test';

import { ChatManagerImpl } from '../../src/chat/ChatManager.js';
import type { ToolCall } from '../../src/chat/types/tool.js';
import {
  getApprovedCommandRegistry,
  hashCommand,
} from '../../src/permission/ApprovedCommandRegistry.js';

/** mock 权限管理器：checkPermissionForTool 返回预设决策 */
function makePermissionManager(decision: {
  allowed: boolean;
  behavior?: 'ask' | 'deny';
  submittedToInbox?: boolean;
}) {
  return {
    checkPermissionForTool: async () => ({
      allowed: decision.allowed,
      decision: decision.behavior
        ? { behavior: decision.behavior, reason: `mock-${decision.behavior}` }
        : undefined,
      reason: 'mock-reason',
      submittedToInbox:
        decision.behavior === 'ask' ? decision.submittedToInbox : undefined,
    }),
  };
}

describe('ChatManager 权限三态化（P0-2/P1-2）', () => {
  let cm: ChatManagerImpl;

  beforeEach(() => {
    cm = new ChatManagerImpl();
  });

  it('ask + submittedToInbox:true → 返回 awaiting_approval（非失败语义）', async () => {
    cm.setPermissionManager(
      makePermissionManager({
        allowed: false,
        behavior: 'ask',
        submittedToInbox: true,
      })
    );
    const result = await cm.executeTool({
      id: 'tool-1',
      name: 'bash',
      arguments: { command: 'rm -rf /tmp/abc' },
      sessionId: 'session-1',
    } as ToolCall);
    expect(result.error).toBeUndefined();
    expect(result.result).toMatchObject({
      status: 'awaiting_approval',
      pendingApproval: true,
    });
  });

  it('ask + submittedToInbox:false → 降级返回普通 ask 文本（P1-3）', async () => {
    cm.setPermissionManager(
      makePermissionManager({
        allowed: false,
        behavior: 'ask',
        submittedToInbox: false,
      })
    );
    const result = await cm.executeTool({
      id: 'tool-2',
      name: 'bash',
      arguments: { command: 'rm -rf /tmp/abc' },
      sessionId: 'session-1',
    } as ToolCall);
    expect(result.error).toContain('需要用户确认');
    expect(result.result).toBeNull();
  });

  it('deny 决策 → 拦截返回 error', async () => {
    cm.setPermissionManager(
      makePermissionManager({ allowed: false, behavior: 'deny' })
    );
    const result = await cm.executeTool({
      id: 'tool-3',
      name: 'bash',
      arguments: { command: 'rm -rf /tmp/abc' },
      sessionId: 'session-1',
    } as ToolCall);
    expect(result.error).toContain('Permission denied');
    expect(result.result).toBeNull();
  });

  it('allow 决策 → 通过权限层继续执行（无 toolRegistry 时报执行错误）', async () => {
    cm.setPermissionManager(makePermissionManager({ allowed: true }));
    const result = await cm.executeTool({
      id: 'tool-4',
      name: 'bash',
      arguments: { command: 'echo hi' },
      sessionId: 'session-1',
    } as ToolCall);
    // 已越过权限层，走到工具执行层（未装配 toolRegistry → 执行错误，而非权限错误）
    expect(result.error).toContain('No tool integration or tool registry');
    expect(result.error).not.toContain('Permission denied');
  });

  it('ask + 放行缓存命中 → 跳过 ask 直接放行执行（不弹卡）', async () => {
    // 模拟批准后 LLM 重发：命令 hash 已在放行缓存中
    getApprovedCommandRegistry().approve(
      'session-1',
      hashCommand('echo format-test')
    );
    cm.setPermissionManager(
      makePermissionManager({
        allowed: false,
        behavior: 'ask',
        submittedToInbox: true,
      })
    );
    const result = await cm.executeTool({
      id: 'tool-5',
      name: 'bash',
      arguments: { command: 'echo format-test' },
      sessionId: 'session-1',
    } as ToolCall);
    // 非 awaiting_approval → 已放行；无 toolRegistry → 执行错误（而非审批卡片）
    expect(result.result).toBeNull();
    expect(result.error).toContain('No tool integration or tool registry');
    getApprovedCommandRegistry().clearSession('session-1');
  });

  it('ask + 放行缓存未命中 → 仍返回 awaiting_approval', async () => {
    // 放行缓存中只有别的命令
    getApprovedCommandRegistry().approve(
      'session-1',
      hashCommand('echo other-command')
    );
    cm.setPermissionManager(
      makePermissionManager({
        allowed: false,
        behavior: 'ask',
        submittedToInbox: true,
      })
    );
    const result = await cm.executeTool({
      id: 'tool-6',
      name: 'bash',
      arguments: { command: 'rm -rf /tmp/abc' },
      sessionId: 'session-1',
    } as ToolCall);
    expect(result.result).toMatchObject({
      status: 'awaiting_approval',
      pendingApproval: true,
    });
    getApprovedCommandRegistry().clearSession('session-1');
  });
});
