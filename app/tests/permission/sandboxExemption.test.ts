// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * PR-3b：沙箱豁免判定（`permission/sandboxExemption`）单测。
 *
 * 断言的是**安全姿态**：S1–S4 任一不满足都必须**不豁免**（fail-closed），
 * 且"命令类"永远不因沙箱而免审批（S4 的网络/端口范围无法证明）。
 */

import { describe, expect, it } from 'bun:test';

import { resolveSandboxExemption } from '../../src/permission/sandboxExemption.js';
import { RiskClass } from '../../src/permission/types/RiskClass.js';

const workspace = process.cwd();
const isolated = {
  mode: 'landlock' as const,
  permissionLevel: 'standard' as const,
  // 方案 A（2026-10-23）：文件类能力还要求"文件 IO 可证隔离"（隔离适配器 + 挂载映射）
  fileIoIsolated: true,
};

describe('PR-3b 沙箱豁免：S1 隔离可证', () => {
  it('无信号 ⇒ 不豁免（缺失不当成放行）', () => {
    expect(
      resolveSandboxExemption({
        risk: RiskClass.WRITE_LOCAL,
        sandboxLevel: 'file-io',
        input: { path: 'a.txt' },
        workspacePath: workspace,
      })
    ).toEqual({ exempt: false, reason: 'no-signal' });
  });

  it("mode='none' ⇒ 不豁免", () => {
    expect(
      resolveSandboxExemption({
        signal: { mode: 'none', permissionLevel: 'full' },
        risk: RiskClass.WRITE_LOCAL,
        sandboxLevel: 'file-io',
        input: { path: 'a.txt' },
        workspacePath: workspace,
      })
    ).toEqual({ exempt: false, reason: 'no-isolation' });
  });
});

describe('PR-3b 沙箱豁免：S4 / 风险级', () => {
  it('命令类（SHELL）永远不豁免（网络/端口无法证明）', () => {
    expect(
      resolveSandboxExemption({
        signal: isolated,
        risk: RiskClass.SHELL,
        sandboxLevel: 'execution',
        input: { command: 'ls' },
        workspacePath: workspace,
      })
    ).toEqual({ exempt: false, reason: 'shell-unprovable' });
  });

  it('外部副作用 / 未声明 ⇒ 不豁免', () => {
    for (const risk of [RiskClass.EXTERNAL, RiskClass.UNDECLARED]) {
      expect(
        resolveSandboxExemption({
          signal: isolated,
          risk,
          sandboxLevel: 'execution',
          input: { path: 'a.txt' },
          workspacePath: workspace,
        })
      ).toEqual({ exempt: false, reason: 'risk-not-exemptable' });
    }
  });

  it('无工作区边界 ⇒ 不豁免', () => {
    expect(
      resolveSandboxExemption({
        signal: isolated,
        risk: RiskClass.WRITE_LOCAL,
        sandboxLevel: 'file-io',
        input: { path: 'a.txt' },
      })
    ).toEqual({ exempt: false, reason: 'no-workspace' });
  });

  it('无路径参数 ⇒ 不豁免（范围不可证）', () => {
    expect(
      resolveSandboxExemption({
        signal: isolated,
        risk: RiskClass.WRITE_LOCAL,
        sandboxLevel: 'file-io',
        input: { content: 'hi' },
        workspacePath: workspace,
      })
    ).toEqual({ exempt: false, reason: 'no-path-arg' });
  });

  it('路径越界 ⇒ 不豁免', () => {
    expect(
      resolveSandboxExemption({
        signal: isolated,
        risk: RiskClass.WRITE_LOCAL,
        sandboxLevel: 'file-io',
        input: { path: '../outside.txt' },
        workspacePath: workspace,
      })
    ).toEqual({ exempt: false, reason: 'outside-workspace' });
  });
});

describe('PR-3b 沙箱豁免：S2 能力声明 / S3 权限位', () => {
  it('未声明 sandboxLevel ⇒ 不豁免', () => {
    expect(
      resolveSandboxExemption({
        signal: isolated,
        risk: RiskClass.WRITE_LOCAL,
        input: { path: 'a.txt' },
        workspacePath: workspace,
      })
    ).toEqual({ exempt: false, reason: 'capability-undeclared' });
  });

  it('声明不足（写操作只声明 readonly）⇒ 不豁免', () => {
    expect(
      resolveSandboxExemption({
        signal: isolated,
        risk: RiskClass.WRITE_LOCAL,
        sandboxLevel: 'readonly',
        input: { path: 'a.txt' },
        workspacePath: workspace,
      })
    ).toEqual({ exempt: false, reason: 'capability-insufficient' });
  });

  it('权限位不足（写操作但沙箱只有 readonly）⇒ 不豁免', () => {
    expect(
      resolveSandboxExemption({
        signal: {
          mode: 'landlock',
          permissionLevel: 'readonly',
          fileIoIsolated: true,
        },
        risk: RiskClass.WRITE_LOCAL,
        sandboxLevel: 'file-io',
        input: { path: 'a.txt' },
        workspacePath: workspace,
      })
    ).toEqual({ exempt: false, reason: 'permission-insufficient' });
  });
});

describe('方案 A 沙箱豁免：S1b 文件 IO 可证隔离', () => {
  it('缺 fileIoIsolated ⇒ 不豁免（Landlock 只包命令子进程，宿主 node:fs 未被隔离）', () => {
    expect(
      resolveSandboxExemption({
        signal: { mode: 'landlock', permissionLevel: 'standard' },
        risk: RiskClass.WRITE_LOCAL,
        sandboxLevel: 'file-io',
        input: { path: 'a.txt' },
        workspacePath: workspace,
      })
    ).toEqual({ exempt: false, reason: 'file-io-not-isolated' });
  });

  it('fileIoIsolated=false ⇒ 不豁免', () => {
    expect(
      resolveSandboxExemption({
        signal: {
          mode: 'landlock',
          permissionLevel: 'standard',
          fileIoIsolated: false,
        },
        risk: RiskClass.WRITE_LOCAL,
        sandboxLevel: 'file-io',
        input: { path: 'a.txt' },
        workspacePath: workspace,
      })
    ).toEqual({ exempt: false, reason: 'file-io-not-isolated' });
  });

  it('只读能力同样要求文件 IO 可证隔离', () => {
    expect(
      resolveSandboxExemption({
        signal: { mode: 'landlock', permissionLevel: 'readonly' },
        risk: RiskClass.READ,
        sandboxLevel: 'readonly',
        input: { path: 'a.txt' },
        workspacePath: workspace,
      })
    ).toEqual({ exempt: false, reason: 'file-io-not-isolated' });
  });
});

describe('§12.15 沙箱豁免：S4b 工具落点根须已挂载', () => {
  const containerSignal = {
    mode: 'container' as const,
    permissionLevel: 'standard' as const,
    fileIoIsolated: true,
    fileIoRoots: ['/host/ws'],
  };

  it('targetRoot 落在已挂载根内 ⇒ 豁免', () => {
    expect(
      resolveSandboxExemption({
        signal: containerSignal,
        risk: RiskClass.WRITE_LOCAL,
        sandboxLevel: 'file-io',
        input: { relativePath: 'a.md' },
        workspacePath: '/host/ws',
        targetRoot: '/host/ws/projects/p1',
      })
    ).toEqual({ exempt: true, reason: 'sandbox-isolated' });
  });

  it('targetRoot 未被挂载 ⇒ 不豁免（防"S4 按会话工作区误判为界内"）', () => {
    expect(
      resolveSandboxExemption({
        signal: containerSignal,
        risk: RiskClass.WRITE_LOCAL,
        sandboxLevel: 'file-io',
        input: { relativePath: 'a.md' },
        workspacePath: '/host/ws',
        targetRoot: '/data/projects/p1',
      })
    ).toEqual({ exempt: false, reason: 'target-root-not-mounted' });
  });

  it('signal 缺 fileIoRoots ⇒ 不豁免（无挂载证据）', () => {
    expect(
      resolveSandboxExemption({
        signal: {
          mode: 'container',
          permissionLevel: 'standard',
          fileIoIsolated: true,
        },
        risk: RiskClass.WRITE_LOCAL,
        sandboxLevel: 'file-io',
        input: { relativePath: 'a.md' },
        workspacePath: '/host/ws',
        targetRoot: '/host/ws/projects/p1',
      })
    ).toEqual({ exempt: false, reason: 'target-root-not-mounted' });
  });
});

describe('PR-3b 沙箱豁免：四前提全满足', () => {
  it('写操作（file-io + standard + 工作区内）⇒ 豁免', () => {
    expect(
      resolveSandboxExemption({
        signal: isolated,
        risk: RiskClass.WRITE_LOCAL,
        sandboxLevel: 'file-io',
        input: { path: 'a.txt' },
        workspacePath: workspace,
      })
    ).toEqual({ exempt: true, reason: 'sandbox-isolated' });
  });

  it('只读操作（readonly 能力）⇒ 豁免', () => {
    expect(
      resolveSandboxExemption({
        signal: {
          mode: 'landlock',
          permissionLevel: 'readonly',
          fileIoIsolated: true,
        },
        risk: RiskClass.READ,
        sandboxLevel: 'readonly',
        input: { path: 'a.txt' },
        workspacePath: workspace,
      })
    ).toEqual({ exempt: true, reason: 'sandbox-isolated' });
  });
});
