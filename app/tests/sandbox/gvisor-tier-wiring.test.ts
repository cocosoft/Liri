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
 * D5 档位接线：配置 → 沙箱实现分派
 *
 * 结论：实现选型由 `SandboxManagerImpl.createSandbox()` 依 `customConfig` 决定，
 * **不需要**给 `SandboxMode`（策略层：工具白名单/交互）新增枚举值。
 * 配置 `{ dockerImage, dockerRuntime: 'runsc' }` 即得到 gVisor 档。
 *
 * 本机无 docker/runsc，故只固化"分派可达"，不验证容器真实创建。
 */

import { describe, expect, it } from 'bun:test';
import { SandboxManagerImpl } from '../../src/sandbox/SandboxImpl';
import { DockerSandbox } from '../../src/sandbox/docker/DockerSandbox';
import { SandboxPlatform } from '../../src/sandbox/SandboxTypes';
import type { SandboxConfig } from '../../src/sandbox/SandboxTypes';

function config(customConfig: Record<string, unknown>): SandboxConfig {
  return {
    platform: SandboxPlatform.LINUX,
    customConfig,
  } as unknown as SandboxConfig;
}

describe('D5 gVisor 档位接线', () => {
  const manager = new SandboxManagerImpl();

  it('配置 dockerImage + dockerRuntime=runsc → 分派到 DockerSandbox（gVisor 档可达）', () => {
    const sandbox = manager.createSandbox(
      config({ dockerImage: 'node:24-alpine', dockerRuntime: 'runsc' })
    );
    expect(sandbox).toBeInstanceOf(DockerSandbox);
  });

  it('仅 dockerImage → 同样分派到 DockerSandbox（未设 runtime 时行为不变）', () => {
    const sandbox = manager.createSandbox(
      config({ dockerImage: 'node:24-alpine' })
    );
    expect(sandbox).toBeInstanceOf(DockerSandbox);
  });

  it('无 dockerImage → 按平台分派，不误判为 Docker 档', () => {
    const sandbox = manager.createSandbox(config({ dockerRuntime: 'runsc' }));
    expect(sandbox).not.toBeInstanceOf(DockerSandbox);
  });
});
