// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * PR-3b/3c：沙箱豁免的**接线级**回归（不只测纯函数）。
 *
 * 覆盖三件事：
 * ① 四前提满足 ⇒ 决策从 ask 变为 **allow**（且仅在风险默认档处变化）；
 * ② 无沙箱信号 ⇒ 仍 **ask**（fail-closed 接线，不许把缺失当放行）；
 * ③ 豁免命中时确实调用**注入的审计出口**（`approval:sandbox`）。
 *
 * 背景（项目教训）：只验证纯函数无法保证接线，逻辑被删掉也能全绿。
 */

import { afterEach, describe, expect, it } from 'bun:test';

import { RuleManager } from '../../src/permission/RuleManager.js';
import {
  PermissionChecker,
  setPermissionRuntimeDeps,
} from '../../src/permission/PermissionChecker.js';
import { PermissionDecisionType } from '../../src/permission/types/PermissionDecision.js';

const workspace = process.cwd();
const isolated = {
  mode: 'landlock' as const,
  permissionLevel: 'standard' as const,
  // 方案 A（2026-10-23）：文件类工具还要求"文件 IO 可证隔离"（隔离适配器 + 挂载映射）
  fileIoIsolated: true,
};
/** 最小工具桩：`file_write` 形状（本地写 + 已声明 file-io 能力） */
const fileWriteLike = {
  name: 'file_write',
  sandboxLevel: 'file-io' as const,
  riskClass: 'write' as const,
};

type AuditEvent = {
  rule: string;
  toolName: string;
  risk: string;
  sessionId?: string;
  detail: string;
};

const captured: AuditEvent[] = [];

function installDeps(): void {
  setPermissionRuntimeDeps({
    unattendedMode: {
      isUnattended: () => false,
      shouldAutoApprove: () => false,
    },
    inboxManager: { submit: async () => ({ id: 'test' }) },
    auditAutoAllow: (e) => {
      captured.push(e);
    },
  });
}

afterEach(() => {
  captured.length = 0;
});

function decide(params: {
  sandbox?: {
    mode: 'landlock' | 'none';
    permissionLevel: 'readonly' | 'standard' | 'full';
    fileIoIsolated?: boolean;
  };
  input?: Record<string, unknown>;
  workspacePath?: string;
}) {
  const checker = new PermissionChecker(new RuleManager());
  const input = params.input ?? { path: 'a.txt' };
  return checker.checkPermission(fileWriteLike as never, input, {
    toolName: 'file_write',
    input,
    sessionId: 'sess-wiring',
    sandbox: params.sandbox,
    workspacePath: params.workspacePath ?? workspace,
  } as never);
}

describe('PR-3b 接线：沙箱豁免改变的是"风险默认档"', () => {
  it('四前提满足 ⇒ allow', async () => {
    installDeps();
    const decision = await decide({ sandbox: isolated });
    expect(decision.type).toBe(PermissionDecisionType.ALLOW);
  });

  it('无沙箱信号 ⇒ 仍 ask（fail-closed）', async () => {
    installDeps();
    const decision = await decide({});
    expect(decision.type).toBe(PermissionDecisionType.ASK);
  });

  it("mode='none' ⇒ 仍 ask", async () => {
    installDeps();
    const decision = await decide({
      sandbox: { mode: 'none', permissionLevel: 'full' },
    });
    expect(decision.type).toBe(PermissionDecisionType.ASK);
  });

  it('文件 IO 未证隔离（无 fileIoIsolated）⇒ 仍 ask（S1b）', async () => {
    installDeps();
    const decision = await decide({
      sandbox: { mode: 'landlock', permissionLevel: 'standard' },
    });
    expect(decision.type).toBe(PermissionDecisionType.ASK);
  });

  it('路径越界 ⇒ 仍 ask（S4）', async () => {
    installDeps();
    const decision = await decide({
      sandbox: isolated,
      input: { path: '../outside.txt' },
    });
    expect(decision.type).toBe(PermissionDecisionType.ASK);
  });
});

describe('PR-3c 接线：豁免命中写审计出口', () => {
  it('命中 ⇒ auditAutoAllow 收到 approval:sandbox（带模式信息）', async () => {
    installDeps();
    await decide({ sandbox: isolated });

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      rule: 'approval:sandbox',
      toolName: 'file_write',
      risk: 'write',
      sessionId: 'sess-wiring',
    });
    expect(captured[0].detail).toContain('landlock');
  });

  it('未命中 ⇒ 不写 approval:sandbox 审计', async () => {
    installDeps();
    await decide({});
    expect(captured.filter((e) => e.rule === 'approval:sandbox')).toHaveLength(
      0
    );
  });
});
