// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P1（2026-11-04）：`resolvePolicy` —— 权限判定的**唯一出口**。
 *
 * 这些都是**纯归一**用例：给假端口喂 `PermissionDecision`，断言 `PolicyDecision` 的
 * `effect` / `reasonCode` / `evidence` 结构（判定链本身由 `tests/permission` 其余用例覆盖）。
 */

import { describe, it, expect } from 'bun:test';
import {
  resolvePolicy,
  type PolicyDecisionPort,
} from '@openliri/infra/permission';
import { PermissionDecisionType } from '@openliri/infra/permission/types/PermissionDecision';
import type { PermissionMode } from '@openliri/infra/permission/PermissionMode';

function portReturning(
  decision: {
    type: PermissionDecisionType;
    reason?: string;
    context?: Record<string, unknown>;
  },
  mode?: PermissionMode
): PolicyDecisionPort {
  return {
    checkPermission: async () => ({
      type: decision.type,
      reason: decision.reason ?? '',
      context: decision.context,
    }),
    ...(mode ? { getMode: () => mode } : {}),
  };
}

describe('P1：resolvePolicy 归一', () => {
  it('allow 且无规则依据 ⇒ allow-by-mode，并带出生效模式', async () => {
    const decision = await resolvePolicy(
      portReturning(
        { type: PermissionDecisionType.ALLOW, reason: '默认放行' },
        'default'
      ),
      { toolOrName: 'read_file', input: {} }
    );
    expect(decision.effect).toBe('allow');
    expect(decision.reasonCode).toBe('allow-by-mode');
    expect(decision.evidence).toEqual({ source: 'mode', mode: 'default' });
    expect(decision.reason).toBe('默认放行');
  });

  it('deny 带 ruleId ⇒ deny-by-rule，并如实带出规则来源', async () => {
    const decision = await resolvePolicy(
      portReturning({
        type: PermissionDecisionType.DENY,
        reason: '命中黑名单',
        context: { ruleId: 'rule-7', sourceKind: 'userSettings' },
      }),
      { toolOrName: 'bash', input: { command: 'rm -rf /' } }
    );
    expect(decision.effect).toBe('deny');
    expect(decision.reasonCode).toBe('deny-by-rule');
    expect(decision.evidence).toMatchObject({
      source: 'deny-rule',
      ruleId: 'rule-7',
      sourceKind: 'userSettings',
    });
  });

  it('ask 有 ruleId ⇒ ask-by-rule；无 ruleId ⇒ ask-by-mode', async () => {
    const byRule = await resolvePolicy(
      portReturning({
        type: PermissionDecisionType.ASK,
        context: { ruleId: 'rule-ask-1' },
      }),
      { toolOrName: 'bash', input: {} }
    );
    expect(byRule.reasonCode).toBe('ask-by-rule');
    expect(byRule.evidence.source).toBe('ask-rule');

    const byMode = await resolvePolicy(
      portReturning({ type: PermissionDecisionType.ASK }, 'strict'),
      { toolOrName: 'bash', input: {} }
    );
    expect(byMode.reasonCode).toBe('ask-by-mode');
    expect(byMode.evidence).toMatchObject({ source: 'mode', mode: 'strict' });
  });

  it('会话级 permissionMode 优先于端口默认档（evidence.mode 反映实际生效档）', async () => {
    const decision = await resolvePolicy(
      portReturning({ type: PermissionDecisionType.ALLOW }, 'default'),
      {
        toolOrName: 'read_file',
        input: {},
        context: { toolName: 'read_file', input: {}, permissionMode: 'bypass' },
      }
    );
    expect(decision.evidence.mode).toBe('bypass');
  });

  it('调用方已算好审批指纹 ⇒ approval 带上 once 作用域；未传则不带', async () => {
    const withPrint = await resolvePolicy(
      portReturning({ type: PermissionDecisionType.ASK }),
      { toolOrName: 'bash', input: {}, approvalFingerprint: 'fp-1' }
    );
    expect(withPrint.approval).toEqual({ scope: 'once', fingerprint: 'fp-1' });

    const withoutPrint = await resolvePolicy(
      portReturning({ type: PermissionDecisionType.ASK }),
      { toolOrName: 'bash', input: {} }
    );
    expect(withoutPrint.approval).toBeUndefined();
  });
});
