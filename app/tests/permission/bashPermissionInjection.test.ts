/**
 * `BashPermission` 审批评估器注入（`lint:infra` R2/R3 清零后的口径）
 *
 * 背景：`SmartApprovalObserver` 属 app 层，permission 属 infra ⇒ 原 `require('@modules/tools/…')`
 * 构成 infra → app 动态倒挂。改为由 app/entry 注入评估器；未注入时一律**询问**（fail-safe）。
 *
 * ① 未注入 ⇒ ASK（不静默放行）；
 * ② 注入 auto_allow / auto_deny ⇒ 决策透传；
 * ③ 内置危险命令优先于评估器（评估器不被调用）；
 * ④ disposer 恢复注入前状态（注册 → disposer 约定）。
 */
import { afterEach, describe, expect, it } from 'bun:test';

import {
  BashPermission,
  setCommandApprovalEvaluator,
} from '../../src/permission/integrations/BashPermission';
import {
  createPermissionContext,
  type PermissionContext,
} from '../../src/permission/types/PermissionContext';
import { PermissionDecisionType } from '../../src/permission/types/PermissionDecision';

function context(command: string): PermissionContext {
  return createPermissionContext({
    toolName: 'Bash',
    input: { command },
  });
}

let dispose: (() => void) | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
});

describe('BashPermission 审批评估器注入', () => {
  it('未注入 ⇒ ASK（fail-safe，不静默放行）', () => {
    const decision = BashPermission.checkPermission(
      { command: 'ls -la' },
      context('ls -la')
    );
    expect(decision.type).toBe(PermissionDecisionType.ASK);
    expect(decision.reason).toContain('未注入');
  });

  it('注入 auto_allow ⇒ ALLOW', () => {
    dispose = setCommandApprovalEvaluator(() => ({
      decision: 'auto_allow',
      reason: 'safe pattern',
    }));
    const decision = BashPermission.checkPermission(
      { command: 'ls -la' },
      context('ls -la')
    );
    expect(decision.type).toBe(PermissionDecisionType.ALLOW);
    expect(decision.reason).toBe('safe pattern');
  });

  it('注入 auto_deny ⇒ DENY', () => {
    dispose = setCommandApprovalEvaluator(() => ({
      decision: 'auto_deny',
      reason: 'blocked',
    }));
    const decision = BashPermission.checkPermission(
      { command: 'ls -la' },
      context('ls -la')
    );
    expect(decision.type).toBe(PermissionDecisionType.DENY);
  });

  it('内置危险命令优先：评估器不被调用', () => {
    let called = false;
    dispose = setCommandApprovalEvaluator(() => {
      called = true;
      return { decision: 'auto_allow', reason: 'should not reach' };
    });
    const decision = BashPermission.checkPermission(
      { command: 'rm -rf /' },
      context('rm -rf /')
    );
    expect(decision.type).toBe(PermissionDecisionType.ASK);
    expect(called).toBe(false);
  });

  it('disposer 恢复注入前状态', () => {
    const release = setCommandApprovalEvaluator(() => ({
      decision: 'auto_allow',
      reason: 'safe',
    }));
    release();
    const decision = BashPermission.checkPermission(
      { command: 'ls -la' },
      context('ls -la')
    );
    expect(decision.type).toBe(PermissionDecisionType.ASK);
  });
});
