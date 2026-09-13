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
 * D5 验收（可执行版）：gVisor 隔离档真机集成验收
 *
 * 对应计划 §D5「验收标准」两条：
 *   ① 新档跑通沙箱集成测试 —— 配置 `{ dockerImage, dockerRuntime: 'runsc' }` 后
 *      容器**确实以 `runsc` 运行时创建**，且容器内命令可执行并返回输出；
 *   ② 逃逸类用例被阻断 —— 宿主文件系统在容器内不可见、根文件系统不可写。
 *
 * 环境门控（**skip ≠ pass**，绝不伪造验收）：
 * 仅当 `docker info` 可用**且**其 runtimes 列表含 `runsc` 时才执行；
 * 否则整体 `skip`（本机即处于此状态：Docker 守护进程未运行、gVisor 未安装）。
 *
 * 诚实标注：本文件在**无 Docker+gVisor 的环境**下只验证了"跳过路径 + 类型/编译"，
 * **真实容器断言未在本机跑过**；需在具备 Docker + gVisor 的机器/CI 上执行才算完成
 * 验收（执行命令：`bun test tests/sandbox/gvisor-integration.test.ts --timeout 300000`，
 * 放宽超时是因为镜像拉取可能远超 bun 默认 5s）。
 */

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SandboxManagerImpl } from '../../src/sandbox/SandboxImpl';
import { SandboxPlatform } from '../../src/sandbox/SandboxTypes';
import type { Sandbox, SandboxConfig } from '../../src/sandbox/SandboxTypes';
import { DOCKER_CONFIG_KEYS } from '../../src/sandbox/docker/DockerSandbox';

/** 读取 Docker 引擎支持的运行时列表；引擎不可用时返回 null（不抛错，供门控判断） */
function readDockerRuntimes(): string | null {
  try {
    return execFileSync('docker', ['info', '--format', '{{json .Runtimes}}'], {
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

const DOCKER_RUNTIMES = readDockerRuntimes();
const HAS_GVISOR =
  DOCKER_RUNTIMES !== null && DOCKER_RUNTIMES.includes('runsc');

/** 验收用镜像（可用环境变量覆盖） */
const TEST_IMAGE = process.env.LIRI_GVISOR_TEST_IMAGE || 'node:24-alpine';
const CONTAINER_NAME = `pyapp-gvisor-acceptance-${Date.now()}`;

function buildConfig(customConfig: Record<string, unknown>): SandboxConfig {
  return {
    platform: SandboxPlatform.LINUX,
    allowedPermissions: [],
    filesystemWhitelist: [],
    networkWhitelist: [],
    environmentWhitelist: [],
    maxExecutionTime: 60000,
    maxMemory: 512,
    customConfig,
  };
}

// 注意：镜像拉取 + 容器创建可能远超 bun 默认 5s 超时，真机执行时请显式放宽：
//   bun test tests/sandbox/gvisor-integration.test.ts --timeout 300000

describe.skipIf(!HAS_GVISOR)(
  `D5 验收：gVisor 档真机集成（image=${TEST_IMAGE}）`,
  () => {
    const manager = new SandboxManagerImpl();
    let sandbox: Sandbox;
    let hostProbeDir: string;
    const HOST_PROBE_CONTENT = `host-only-${Math.random().toString(36).slice(2)}`;
    const acceptanceConfig = buildConfig({
      [DOCKER_CONFIG_KEYS.IMAGE]: TEST_IMAGE,
      [DOCKER_CONFIG_KEYS.RUNTIME]: 'runsc',
      [DOCKER_CONFIG_KEYS.CONTAINER_NAME]: CONTAINER_NAME,
    });

    beforeAll(async () => {
      // 宿主侧探针文件（容器内不应可见）
      hostProbeDir = mkdtempSync(join(tmpdir(), 'gvisor-acceptance-'));
      writeFileSync(join(hostProbeDir, 'host-probe.txt'), HOST_PROBE_CONTENT);

      sandbox = manager.createSandbox(acceptanceConfig);
      expect(await sandbox.initialize(acceptanceConfig)).toBe(true);
    });

    afterAll(async () => {
      await sandbox?.close();
      if (hostProbeDir) rmSync(hostProbeDir, { recursive: true, force: true });
    });

    it('① 档位生效：容器实际以 runsc（gVisor）运行时创建', () => {
      const runtime = execFileSync(
        'docker',
        ['inspect', CONTAINER_NAME, '--format', '{{.HostConfig.Runtime}}'],
        { encoding: 'utf-8', timeout: 15000 }
      ).trim();
      expect(runtime).toBe('runsc');
    });

    it('① 跑通集成：容器内执行命令并拿到输出', async () => {
      const result = await sandbox.execute({
        args: ['echo', 'gvisor-ok'],
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('gvisor-ok');
    });

    it('② 逃逸阻断：宿主文件系统在容器内不可见', async () => {
      const hostProbe = join(hostProbeDir, 'host-probe.txt');
      const result = await sandbox.execute({
        args: ['cat', hostProbe],
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).not.toContain(HOST_PROBE_CONTENT);
    });

    it('② 逃逸阻断：根文件系统不可写（危险写入被拒）', async () => {
      const result = await sandbox.execute({
        args: ['sh', '-c', 'echo probe > /probe-file && cat /probe-file'],
      });
      expect(result.exitCode).not.toBe(0);
    });
  }
);
