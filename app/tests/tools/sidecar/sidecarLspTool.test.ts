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
 * LSP **侧车工具适配器**单测（S2/T2.2 loader 侧车分支）。
 *
 * 锁定（spec §6.2/§2 反目标「静默双轨」）：
 * - ① 开关开：工具调用**真的经 sidecar request/response**，结果形状与内置一致；
 * - ② 侧车方法未实现 ⇒ **fail-closed 报错**（**不**回落内置"每次 spawn"）；
 * - ③ 侧车不可用 / 握手失败 / 崩溃 ⇒ fail-closed；
 * - ④ 工具面 schema 与内置 `lsp` 逐字一致（`name`/`params`/`maxResultSizeChars`）。
 */
import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import {
  SidecarLspTool,
  type LspSupervisorProvider,
  type LspSidecarRequester,
} from '../../../src/tools/sidecar/SidecarLspTool';
import { ToolSidecarSupervisor } from '../../../src/tools/sidecar/ToolSidecarSupervisor';
import { LSPToolAdapter } from '../../../src/tools/adapters/LSPToolAdapter';
import {
  SIDECAR_IPC_PROTOCOL_VERSION,
  SIDECAR_STARTUP_TYPE,
  encodeFrame,
  decodeFrame,
} from '../../../src/utils/sidecarIpc';
import type { ToolUseContext } from '../../../src/tools/types/ToolUseContext';

const ctx = {} as ToolUseContext;
const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms));

function stubRequester(
  handler: (
    method: string,
    params: Record<string, unknown>
  ) => Record<string, unknown>
): {
  requester: LspSidecarRequester;
  calls: Array<{ method: string; params: Record<string, unknown> }>;
} {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  return {
    calls,
    requester: {
      async request(
        method: string,
        params?: Record<string, unknown>
      ): Promise<Record<string, unknown>> {
        const p = params ?? {};
        calls.push({ method, params: p });
        return handler(method, p);
      },
    },
  };
}

const provider =
  (r: LspSidecarRequester | null): LspSupervisorProvider =>
  async () =>
    r;

describe('侧车 LSP 工具：① 真经 request/response', () => {
  it('hover 经 sidecar 请求并回传结果（形状正确）', async () => {
    const { requester, calls } = stubRequester(() => ({
      id: 'x',
      success: true,
      result: 'HOVER_TEXT',
    }));
    const tool = new SidecarLspTool(provider(requester));
    const res = await tool.execute(
      {
        action: 'hover',
        language: 'typescript',
        document: 'const x = 1;',
        position: { line: 0, character: 6 },
      },
      ctx
    );
    expect(res.success).toBe(true);
    expect(res.data).toBe('HOVER_TEXT');
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('lsp.hover');
    expect(calls[0].params).toMatchObject({
      language: 'typescript',
      document: 'const x = 1;',
      position: { line: 0, character: 6 },
    });
  });

  it('file_path 不存在 ⇒ fail-closed（不回落内置）', async () => {
    const { requester, calls } = stubRequester(() => ({
      id: 'x',
      success: true,
      result: null,
    }));
    const tool = new SidecarLspTool(provider(requester));
    const res = await tool.execute(
      {
        action: 'hover',
        language: 'typescript',
        file_path: '__definitely_missing__/none.ts',
        position: { line: 0, character: 0 },
      },
      ctx
    );
    expect(res.success).toBe(false);
    expect(calls).toHaveLength(0); // 未发起侧车请求
  });

  it('真经 ToolSidecarSupervisor 的 IPC 帧往返（假子进程）', async () => {
    class FakeChild extends EventEmitter {
      stdout = new PassThrough();
      stderr = new PassThrough();
      stdin = new PassThrough();
      kill(): boolean {
        return true;
      }
    }
    const child = new FakeChild();
    let seenMethod = '';
    child.stdin.on('data', (chunk: Buffer) => {
      const line = chunk
        .toString()
        .split('\n')
        .find((l) => l.trim().length > 0);
      if (!line) return;
      const frame = decodeFrame(line);
      if (!frame || typeof frame.id !== 'string') return;
      seenMethod = String(frame.method);
      child.stdout.write(
        encodeFrame({ id: frame.id, success: true, result: 'OVER_IPC' })
      );
    });
    const sup = new ToolSidecarSupervisor({
      spawnFn: () => child as unknown as ChildProcess,
    });
    const started = sup.start();
    child.stdout.write(
      encodeFrame({
        type: SIDECAR_STARTUP_TYPE,
        protocolVersion: SIDECAR_IPC_PROTOCOL_VERSION,
        pid: 1,
      }) + '\n'
    );
    await started;
    const tool = new SidecarLspTool(async () => sup);
    const res = await tool.execute(
      {
        action: 'hover',
        language: 'typescript',
        document: 'x',
        position: { line: 0, character: 0 },
      },
      ctx
    );
    expect(res.success).toBe(true);
    expect(res.data).toBe('OVER_IPC');
    expect(seenMethod).toBe('lsp.hover');
    sup.stop();
  });
});

describe('侧车 LSP 工具：② 方法未实现 ⇒ fail-closed', () => {
  it('NOT_IMPLEMENTED 传到工具结果，且不回落内置', async () => {
    const { requester } = stubRequester(() => {
      throw new Error('[NOT_IMPLEMENTED] LSP 侧车方法未实现（rename）');
    });
    const tool = new SidecarLspTool(provider(requester));
    const res = await tool.execute(
      {
        action: 'rename',
        language: 'typescript',
        document: 'x',
        position: { line: 0, character: 0 },
        newName: 'y',
      },
      ctx
    );
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('NOT_IMPLEMENTED');
    expect(tool).not.toBeInstanceOf(LSPToolAdapter);
  });
});

describe('侧车 LSP 工具：③ 侧车不可用 ⇒ fail-closed', () => {
  it('provider 返回 null（未启动/握手失败）⇒ fail-closed', async () => {
    const tool = new SidecarLspTool(provider(null));
    const res = await tool.execute(
      { action: 'hover', language: 'typescript', document: 'x' },
      ctx
    );
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('侧车不可用');
    expect(tool).not.toBeInstanceOf(LSPToolAdapter);
  });

  it('侧车崩溃（request 被拒）⇒ fail-closed', async () => {
    const { requester } = stubRequester(() => {
      throw new Error('工具侧车已退出（code=1）');
    });
    const tool = new SidecarLspTool(provider(requester));
    const res = await tool.execute(
      { action: 'hover', language: 'typescript', document: 'x' },
      ctx
    );
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('已退出');
    await tick(0);
  });
});

describe('侧车 LSP 工具：④ 工具面 schema 与内置一致', () => {
  it('name / params / maxResultSizeChars / aliases / tags 逐字一致', () => {
    const builtin = new LSPToolAdapter();
    const sidecar = new SidecarLspTool(provider(null));
    expect(sidecar.name).toBe(builtin.name);
    expect(sidecar.params).toEqual(builtin.params);
    expect(sidecar.maxResultSizeChars).toBe(builtin.maxResultSizeChars);
    expect(sidecar.aliases).toEqual(builtin.aliases);
    expect(sidecar.getInfo().tags).toEqual(builtin.getInfo().tags);
  });
});
