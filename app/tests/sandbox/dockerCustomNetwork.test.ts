/**
 * B 组遗留修复（2026-09-26）：`custom` 网络模式**恒不可用**。
 *
 * **缺口（B 组 spec §7-7 记录的预存项）**：`DockerSandbox` 构造 `networkConfig` 时**从不填**
 * `customNetworkName`（连配置键都没有），而 `validateDockerNetworkConfig` 对 `mode === 'custom'`
 * **强制要求**名字 ⇒ 无论用户怎么配，`initialize()` 都会在 `INVALID_NETWORK_MODE` 处抛错。
 * 声明层 `compileNetworkPolicy` 本就支持 custom（缺名才 fail-closed 为 `none`），只是名字从未被传进去。
 *
 * 本文件锁四件事（全离线，无需 Docker）：
 *  ① 声明层：custom + 名字 ⇒ `--network <名字>`；
 *  ② 声明层：custom **缺名** ⇒ fail-closed 为 `none`（**既有行为不许回退**）；
 *  ③ 端到端：配了模式 + 名字 ⇒ `initialize()` 成功，且 `docker create` 参数里**确有** `--network <名字>`；
 *  ④ 端到端：配了 custom 但**没给名字** ⇒ 仍按 `INVALID_NETWORK_MODE` 拒绝（**不静默放过**）。
 */
import { describe, expect, it } from 'bun:test';
import { DockerSandbox } from '../../src/sandbox/docker/DockerSandbox';
import { compileNetworkPolicy } from '../../src/sandbox/docker/NetworkPolicyEngine';
import {
  validateDockerNetworkConfig,
  type DockerNetworkConfig,
} from '../../src/sandbox/docker/DockerNetworkPolicy';
import type { DockerCliResult } from '../../src/sandbox/docker/dockerCli';
import type {
  SandboxConfig,
  SandboxPlatform,
} from '../../src/sandbox/SandboxTypes';

/**
 * 脚本化假执行器：全部成功；`create` 回一个**容器 id**（B4 后 `initialize` 要求 create 有输出，
 * 空输出会被判为失败）；`seen` 记录每次调用参数。
 */
function scriptedRun(seen: string[][]) {
  const run = async (args: string[]): Promise<DockerCliResult> => {
    seen.push(args);
    const stdout = args[0] === 'create' ? 'cafebabe1234\n' : '';
    return { code: 0, stdout, stderr: '', ok: true, timedOut: false };
  };
  return run;
}

function config(custom: Record<string, unknown>): SandboxConfig {
  return {
    platform: 'docker' as SandboxPlatform,
    allowedPermissions: [],
    filesystemWhitelist: [],
    networkWhitelist: [],
    environmentWhitelist: [],
    maxExecutionTime: 30_000,
    maxMemory: 512,
    customConfig: custom,
  };
}

describe('custom 网络：声明层（compileNetworkPolicy）', () => {
  it('给了名字 ⇒ --network <名字>（不再把字面量 "custom" 当网络名）', () => {
    const plan = compileNetworkPolicy({
      mode: 'custom',
      customNetworkName: 'liri-net',
    });

    // `sourceMode` / `effectiveNetworkMode` 保留源模式 'custom'；**落到 docker 参数**的才是网络名
    expect(plan.sourceMode).toBe('custom');
    expect(plan.effectiveNetworkMode).toBe('custom');
    expect(plan.narrowedByFailClosed).toBe(false);
    expect(plan.dockerArgs).toContain('--network');
    expect(plan.dockerArgs).toContain('liri-net');
    expect(plan.dockerArgs).not.toContain('custom');
  });

  it('缺名 ⇒ fail-closed 为 none（既有行为，不许回退）', () => {
    const plan = compileNetworkPolicy({ mode: 'custom' });
    expect(plan.dockerArgs).toContain('none');
    expect(plan.dockerArgs).not.toContain('custom');
  });
});

describe('custom 网络：校验层（validateDockerNetworkConfig）', () => {
  it('有名字 ⇒ 通过；无名字 ⇒ 拒绝，且**走到"必须给名字"分支**（该分支此前不可达）', () => {
    expect(
      validateDockerNetworkConfig({
        mode: 'custom',
        customNetworkName: 'liri-net',
      }).valid
    ).toBe(true);

    const noName = validateDockerNetworkConfig({ mode: 'custom' });
    expect(noName.valid).toBe(false);
    // 关键：拒因必须是"必须指定 customNetworkName"，而不是"不支持的网络模式"
    expect(noName.reason).toContain('customNetworkName');
    expect(noName.reason).not.toContain('不支持的网络模式');
  });

  it('接受的模式集合**恰等于**类型 `DockerNetworkMode` 的联合（一致性守卫）', () => {
    // 期望值 = 类型定义 `'none' | 'bridge' | 'host' | 'custom'`（见 DockerNetworkPolicy.ts 顶部）
    const expectedModes = ['none', 'bridge', 'host', 'custom'] as const;
    for (const mode of expectedModes) {
      const result = validateDockerNetworkConfig(
        mode === 'custom' ? { mode, customNetworkName: 'liri-net' } : { mode }
      );
      expect({ mode, valid: result.valid }).toEqual({ mode, valid: true });
    }
  });

  it("`'container'` 被**清晰拒绝**（此前只有它在白名单、不在类型里 ⇒ 会产出 docker 语法错误的 `--network container`）", () => {
    const result = validateDockerNetworkConfig({
      mode: 'container' as unknown as DockerNetworkConfig['mode'],
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('不支持的网络模式');
    // 「可选」列表里不得再列 container（否则用户会照着再配一次）；注意拒因会**回显输入**，故只看列表段
    const optionsPart = result.reason?.split('可选:')[1] ?? '';
    expect(optionsPart).not.toContain('container');
  });
});

describe('custom 网络：DockerSandbox 端到端（假执行器）', () => {
  it('配了 dockerNetworkMode=custom + dockerCustomNetworkName ⇒ initialize 成功且 create 参数带 --network', async () => {
    const seen: string[][] = [];
    const sandbox = new DockerSandbox(scriptedRun(seen));

    const ok = await sandbox.initialize(
      config({
        dockerNetworkMode: 'custom',
        dockerCustomNetworkName: 'liri-net',
      })
    );

    expect(ok).toBe(true);
    const createArgs = seen.find((a) => a[0] === 'create') ?? [];
    expect(createArgs).toContain('--network');
    expect(createArgs).toContain('liri-net');
    // B2 的约束仍然成立：永不出现 NET_ADMIN
    expect(createArgs.join(' ')).not.toContain('NET_ADMIN');
  });

  it('custom 但没给名字 ⇒ 仍拒绝（返回 false，且**根本没碰 docker**，不静默放过）', async () => {
    const seen: string[][] = [];
    const sandbox = new DockerSandbox(scriptedRun(seen));

    const ok = await sandbox.initialize(
      config({ dockerNetworkMode: 'custom' })
    );

    expect(ok).toBe(false);
    // 校验在 `create` 之前拦下 ⇒ **从未**向 docker 下达 create（可用性探测/镜像检查不算）
    expect(seen.some((args) => args[0] === 'create')).toBe(false);
  });
});
