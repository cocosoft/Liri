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
 * 工具侧车 **双跑开关 + loader 分支 + 启动层门控** 单测（S1 骨架）。
 *
 * 锁定：
 * ① 开关关 ⇒ loader 选择与现状一致（`lsp` 由**内置 loader/工厂**产出），且**不启动任何侧车进程**；
 * ② 开关开 ⇒ loader 分支走侧车（`lsp` 由**侧车适配器**产出，不经内置工厂）；
 * ③ 启动层（`maybeStartLspSidecar`）开关关 ⇒ 不 spawn；开关开 ⇒ 按契约启动/握手/关闭（假子进程）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { getBuiltinToolLoaders } from '../../../src/tools/utils/ToolManagerUtils';
import { SidecarLspTool } from '../../../src/tools/sidecar/SidecarLspTool';
import type { ToolFactory } from '../../../src/tools/ToolFactory';
import {
  isLspSidecarEnabled,
  maybeStartLspSidecar,
  stopLspSidecar,
} from '../../../src/tools/sidecar/toolSidecarLifecycle';
import {
  SIDECAR_IPC_PROTOCOL_VERSION,
  SIDECAR_STARTUP_TYPE,
  encodeFrame,
} from '../../../src/utils/sidecarIpc';

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  killed = false;
  kill(): boolean {
    this.killed = true;
    return true;
  }
}
const asChild = (c: FakeChild): ChildProcess => c as unknown as ChildProcess;

/** 假工厂：`byKey` 会以 `this.create(key)` 取构造器 ⇒ 产物打 `fromFactory` 标记便于区分来源 */
const fakeFactory = {
  create: (key: string) => ({
    name: key === 'createLSPTool' ? 'lsp' : `fake_${key}`,
    fromFactory: true,
  }),
} as unknown as ToolFactory;

function effectiveTools(): Array<Record<string, unknown>> {
  return getBuiltinToolLoaders()
    .map((loader) => loader(fakeFactory))
    .filter((tool): tool is NonNullable<typeof tool> => tool !== null)
    .map((tool) => tool as unknown as Record<string, unknown>);
}

function effectiveToolNames(): string[] {
  return effectiveTools().map((tool) => String(tool.name));
}

/** 生效工具面里的 `lsp` 工具（开关关 = 工厂产物；开关开 = 侧车适配器） */
function lspTool(): unknown {
  return effectiveTools().find((tool) => tool.name === 'lsp') ?? null;
}

const ENV_LSP = 'FEATURE_LSP';
const ENV_SIDECAR = 'FEATURE_TOOL_SIDECAR_LSP';
let savedLsp: string | undefined;
let savedSidecar: string | undefined;

beforeEach(() => {
  savedLsp = process.env[ENV_LSP];
  savedSidecar = process.env[ENV_SIDECAR];
  process.env[ENV_LSP] = 'true'; // 打开核心 LSP 工具，使条件工具进入生效视图
  delete process.env[ENV_SIDECAR];
});

afterEach(() => {
  if (savedLsp === undefined) delete process.env[ENV_LSP];
  else process.env[ENV_LSP] = savedLsp;
  if (savedSidecar === undefined) delete process.env[ENV_SIDECAR];
  else process.env[ENV_SIDECAR] = savedSidecar;
  stopLspSidecar();
});

describe('双跑开关：loader 分支选择', () => {
  it('开关关（默认）⇒ 与现状一致：lsp 由内置工厂产出', () => {
    expect(isLspSidecarEnabled()).toBe(false);
    expect(effectiveToolNames()).toContain('lsp');
    expect(lspTool()).toMatchObject({ fromFactory: true });
    expect(lspTool()).not.toBeInstanceOf(SidecarLspTool);
  });

  it('开关开 ⇒ 走侧车 loader 分支（lsp 由侧车适配器产出）', () => {
    process.env[ENV_SIDECAR] = 'true';
    expect(isLspSidecarEnabled()).toBe(true);
    expect(effectiveToolNames()).toContain('lsp');
    expect(lspTool()).toBeInstanceOf(SidecarLspTool);
  });
});

describe('启动层门控：maybeStartLspSidecar', () => {
  it('开关关 ⇒ 不 spawn（零行为变更）', async () => {
    let spawnCalls = 0;
    const result = await maybeStartLspSidecar({
      spawnFn: () => {
        spawnCalls += 1;
        return asChild(new FakeChild());
      },
    });
    expect(result).toBeNull();
    expect(spawnCalls).toBe(0);
  });

  it('开关开 ⇒ 按契约启动/握手/关闭（注入假子进程）', async () => {
    process.env[ENV_SIDECAR] = 'true';
    const fake = new FakeChild();
    const started = maybeStartLspSidecar({ spawnFn: () => asChild(fake) });
    fake.stdout.write(
      encodeFrame({
        type: SIDECAR_STARTUP_TYPE,
        protocolVersion: SIDECAR_IPC_PROTOCOL_VERSION,
        pid: 999,
      }) + '\n'
    );
    const sup = await started;
    expect(sup).not.toBeNull();
    expect(sup?.isRunning()).toBe(true);
    stopLspSidecar();
    expect(fake.killed).toBe(true);
  });
});
