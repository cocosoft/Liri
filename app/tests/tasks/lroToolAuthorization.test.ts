// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * LRO 工具授权归类（2026-11-09）
 *
 * 背景：用户真机会话权限选「全自动」仍弹命令审批。根因之一是长程任务步骤工具
 * **完全绕过权限层**（直接 `tool.execute()`）⇒ 会话 `permission_mode` 从未接线。
 * 本用例钉住新接线（`authorizeToolCall`）的三态归类：
 * - allow + autoApproved ⇒ 放宽档自动放行（工具可跳过 ask 级安全闸）；
 * - allow 无 autoApproved ⇒ 用户逐条批准（**不得**跳过安全闸 ask）；
 * - ask ⇒ 调用方不得执行；deny ⇒ 一律拒绝。
 */

import { describe, expect, it } from 'bun:test';
import { classifyAuthOutcome } from '../../src/tasks/lro/toolAuthorization.js';

describe('classifyAuthOutcome：权限层结论 → LRO 三态', () => {
  it('allow + autoApproved ⇒ 放宽档自动放行（透传权限模式）', () => {
    expect(
      classifyAuthOutcome(
        {
          allowed: true,
          reason: 'bypass mode',
          autoApproved: true,
          approvalSource: 'permission-mode:bypass',
        },
        'bypass'
      )
    ).toEqual({ kind: 'allow', autoApproved: true, permissionMode: 'bypass' });
  });

  it('allow 无 autoApproved ⇒ 不跳过安全闸 ask', () => {
    expect(classifyAuthOutcome({ allowed: true })).toEqual({
      kind: 'allow',
      autoApproved: false,
    });
  });

  it('ask ⇒ ask（调用方不得执行），保留原因与权限模式', () => {
    expect(
      classifyAuthOutcome(
        {
          allowed: false,
          kind: 'ask',
          reason: 'needs approval',
          submittedToInbox: true,
        },
        'default'
      )
    ).toEqual({
      kind: 'ask',
      permissionMode: 'default',
      reason: 'needs approval',
    });
  });

  it('deny ⇒ deny（带原因）', () => {
    expect(
      classifyAuthOutcome({ allowed: false, kind: 'deny', reason: 'blocked' })
    ).toEqual({ kind: 'deny', reason: 'blocked' });
  });

  it('deny 无原因 ⇒ 仍为 deny（不落成 allow）', () => {
    expect(
      classifyAuthOutcome({ allowed: false, kind: 'deny', reason: '' })
    ).toEqual({ kind: 'deny' });
  });
});
