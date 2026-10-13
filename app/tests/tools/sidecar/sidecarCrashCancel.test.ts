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
 * 工具侧车 **S3：崩溃结算/重启 + 取消下传**（T3.1 / T3.2）。
 *
 * 覆盖（spec §3-D5 / §6.3 / §6.4）：
 * - ① 取消下传全链路：`SidecarLspTool` 认领 `AbortSignal` ⇒ supervisor 写 `notify{cancel}`
 *   帧（本地结算）⇒ 侧车中止在飞连接 ⇒ **连接**向 LS 写 `$/cancelRequest`；
 * - ② 崩溃 ⇒ 在飞请求**全拒**（明确错误）且**不自动重试**（无第二次同方法帧）、**不回落内置**；
 * - ③ 有界重启后下一次调用成功（重启未就绪前**不早写**请求）；
 * - ④ 开关关 ⇒ 逐字等价现状（内置 loader，零 spawn）。
 *
 * 真实进程级用**假 LS** 夹具（`../fixtures/fakeLspMethodsServer.js`）打通完整链路
 * （本机无真实 `typescript-language-server`，见计划 T0.1）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolSidecarSupervisor } from '../../../src/tools/sidecar/ToolSidecarSupervisor';
import { SidecarLspTool } from '../../../src/tools/sidecar/SidecarLspTool';
import { startLspSidecar } from '../../../src/tools/sidecar/lspSidecar';
import {
  LspSidecarConnection,
  type LspConnectionPort,
  type LspLocation,
  type LspPosition,
} from '../../../src/tools/sidecar/lspConnection';
import { getBuiltinToolLoaders } from '../../../src/tools/utils/ToolManagerUtils';
import type { ToolFactory } from '../../../src/tools/ToolFactory';
import type { ToolUseContext } from '../../../src/tools/types/ToolUseContext';
import {
  SIDECAR_IPC_PROTOCOL_VERSION,
  SIDECAR_STARTUP_TYPE,
  decodeFrame,
  encodeFrame,
} from '../../../src/utils/sidecarIpc';

const fakeLsScript = fileURLToPath(
  new URL('../fixtures/fakeLspMethodsServer.js', import.meta.url)
);

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
const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(
  cond: () => boolean,
  timeoutMs = 2000,
  stepMs = 5
): Promise<void> {
  const start = Date.now();
  while (!cond() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

const startupLine = (pid = 1): string =>
  encodeFrame({
    type: SIDECAR_STARTUP_TYPE,
    protocolVersion: SIDECAR_IPC_PROTOCOL_VERSION,
    pid,
  }) + '\n';

/** 从 stdin 捕获的 chunk 里解析 sidecar IPC 帧（换行分隔 JSON） */
function ipcFrames(chunks: Buffer[]): Array<Record<string, unknown>> {
  return Buffer.concat(chunks)
    .toString('utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => decodeFrame(l))
    .filter((f): f is Record<string, unknown> => f !== null);
}

/** 从 stdin 捕获的 chunk 里解析 LSP 帧（`Content-Length: N\r\n\r\n<body>`） */
function lspFrames(chunks: Buffer[]): Array<Record<string, unknown>> {
  const text = Buffer.concat(chunks).toString('utf8');
  const out: Array<Record<string, unknown>> = [];
  let i = 0;
  for (;;) {
    const sep = text.indexOf('\r\n\r\n', i);
    if (sep === -1) break;
    const m = text.slice(i, sep).match(/Content-Length: (\d+)/);
    if (!m) {
      i = sep + 4;
      continue;
    }
    const len = Number(m[1]);
    const start = sep + 4;
    if (text.length < start + len) break;
    try {
      out.push(
        JSON.parse(text.slice(start, start + len)) as Record<string, unknown>
      );
    } catch {
      // 非法帧 ⇒ 忽略
    }
    i = start + len;
  }
  return out;
}

function writeLsp(stream: PassThrough, obj: unknown): void {
  const body = JSON.stringify(obj);
  stream.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

async function handshaked(child: FakeChild): Promise<ToolSidecarSupervisor> {
  const sup = new ToolSidecarSupervisor({ spawnFn: () => asChild(child) });
  const p = sup.start();
  child.stdout.write(startupLine());
  await p;
  return sup;
}

const ctxWith = (ctrl: AbortController): ToolUseContext =>
  ({ abortController: ctrl }) as unknown as ToolUseContext;

/** 记录侧车下传的 signal，并按 abort 结算（模拟“侧车 ⇒ LS”段） */
class SignalAwareConnection implements LspConnectionPort {
  lastSignal: AbortSignal | null = null;
  async start(): Promise<void> {
    /* no-op */
  }
  hover(
    _document: string,
    _position: LspPosition,
    _uri?: string,
    signal?: AbortSignal
  ): Promise<string | null> {
    this.lastSignal = signal ?? null;
    return new Promise<string | null>((_resolve, reject) => {
      signal?.addEventListener('abort', () =>
        reject(new Error('LSP 请求已取消：textDocument/hover'))
      );
    });
  }
  async definition(): Promise<LspLocation[]> {
    return [];
  }
  async stop(): Promise<void> {
    /* no-op */
  }
}

describe('S3-① 取消下传：工具 → supervisor → 侧车 → LS', () => {
  it('工具中止 ⇒ supervisor 写 notify{cancel} 帧 + 本地结算（工具返回“已取消”）', async () => {
    const child = new FakeChild();
    const chunks: Buffer[] = [];
    child.stdin.on('data', (c: Buffer) => chunks.push(c));
    const sup = await handshaked(child);
    const tool = new SidecarLspTool(async () => sup);

    const ctrl = new AbortController();
    const execP = tool.execute(
      {
        action: 'hover',
        language: 'typescript',
        document: 'const x = 1;',
        position: { line: 0, character: 6 },
      },
      ctxWith(ctrl)
    );
    await waitFor(() =>
      ipcFrames(chunks).some((f) => f.method === 'lsp.hover')
    );
    const reqId = String(
      ipcFrames(chunks).find((f) => f.method === 'lsp.hover')!.id
    );

    ctrl.abort();

    let done: { success: boolean; error?: unknown } | null = null;
    void execP.then((r) => {
      done = r as { success: boolean; error?: unknown };
    });
    await waitFor(() => done !== null, 500);
    expect(done).not.toBeNull();
    expect(done!.success).toBe(false);
    expect(String(done!.error)).toContain('取消');

    const cancel = ipcFrames(chunks).find(
      (f) => f.type === 'notify' && f.event === 'cancel'
    );
    expect(cancel).toBeDefined();
    expect((cancel!.data as { id?: string }).id).toBe(reqId);
    sup.stop();
  });

  it('侧车收到 notify{cancel} ⇒ 中止在飞连接 + 本地结算（response success:false）', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (c: Buffer) => chunks.push(c));
    let conn: SignalAwareConnection | null = null;
    startLspSidecar({
      input,
      output,
      heartbeatMs: 100_000,
      pid: 1,
      connectionFactory: () => {
        conn = new SignalAwareConnection();
        return conn;
      },
    });
    await tick();

    input.write(
      encodeFrame({
        id: 'r1',
        method: 'lsp.hover',
        params: {
          language: 'typescript',
          document: 'const x = 1;',
          position: { line: 0, character: 6 },
        },
      })
    );
    await waitFor(() => conn !== null && conn!.lastSignal !== null, 500);

    input.write(
      encodeFrame({ type: 'notify', event: 'cancel', data: { id: 'r1' } })
    );
    await waitFor(() => ipcFrames(chunks).some((f) => f.id === 'r1'), 500);

    expect(conn!.lastSignal?.aborted).toBe(true);
    const res = ipcFrames(chunks).find((f) => f.id === 'r1');
    expect(res).toBeDefined();
    expect(res!.success).toBe(false);
  });

  it('连接收到 abort ⇒ 向 LS 写 $/cancelRequest 并拒绝在飞请求', async () => {
    const child = new FakeChild();
    const chunks: Buffer[] = [];
    child.stdin.on('data', (c: Buffer) => chunks.push(c));
    let initialized = false;
    child.stdin.on('data', () => {
      if (initialized) return;
      const init = lspFrames(chunks).find((f) => f.method === 'initialize');
      if (!init || typeof init.id !== 'number') return;
      initialized = true;
      writeLsp(child.stdout, {
        jsonrpc: '2.0',
        id: init.id,
        result: { capabilities: {} },
      });
    });

    const conn = new LspSidecarConnection({
      language: 'typescript',
      serverPath: 'x',
      spawnFn: () => asChild(child),
    });
    await conn.start();

    const ctrl = new AbortController();
    const hoverP = conn.hover(
      'const x = 1;',
      { line: 0, character: 6 },
      'file:///a.ts',
      ctrl.signal
    );
    await waitFor(() =>
      lspFrames(chunks).some((f) => f.method === 'textDocument/hover')
    );
    const hoverId = lspFrames(chunks).find(
      (f) => f.method === 'textDocument/hover'
    )!.id;

    ctrl.abort();

    const settled = await Promise.race([
      hoverP
        .then(() => 'resolved')
        .catch(
          (e: unknown) =>
            `rejected:${e instanceof Error ? e.message : String(e)}`
        ),
      tick(300).then(() => 'timeout'),
    ]);
    expect(String(settled)).toContain('rejected');
    expect(String(settled)).toContain('取消');

    await waitFor(() =>
      lspFrames(chunks).some((f) => f.method === '$/cancelRequest')
    );
    const cancel = lspFrames(chunks).find(
      (f) => f.method === '$/cancelRequest'
    )!;
    expect((cancel.params as { id?: number }).id).toBe(hoverId);
  });
});

describe('S3-② 崩溃结算：在飞全拒、不自动重试、不回落内置', () => {
  it('崩溃 ⇒ 在飞请求全拒（明确错误）且不自动重试（无第二次同方法帧）', async () => {
    const child = new FakeChild();
    const chunks: Buffer[] = [];
    child.stdin.on('data', (c: Buffer) => chunks.push(c));
    const sup = new ToolSidecarSupervisor({
      spawnFn: () => asChild(child),
      maxRestarts: 0,
      requestTimeoutMs: 5000,
    });
    const p = sup.start();
    child.stdout.write(startupLine());
    await p;

    const req = sup.request('lsp.hover', { language: 'typescript' });
    await waitFor(() =>
      ipcFrames(chunks).some((f) => f.method === 'lsp.hover')
    );

    child.emit('exit', 1);
    await expect(req).rejects.toThrow('工具侧车已退出');
    expect(sup.isRunning()).toBe(false);

    await tick(30);
    expect(
      ipcFrames(chunks).filter((f) => f.method === 'lsp.hover')
    ).toHaveLength(1);
    sup.stop();
  });
});

describe('S3-③ 有界重启：重启就绪后下一次调用成功', () => {
  it('崩溃后立即请求：未就绪前不早写，握手后成功', async () => {
    const first = new FakeChild();
    const second = new FakeChild();
    let calls = 0;
    const sup = new ToolSidecarSupervisor({
      startupTimeoutMs: 5000,
      maxRestarts: 2,
      spawnFn: () => asChild(++calls === 1 ? first : second),
    });
    const p = sup.start();
    first.stdout.write(startupLine());
    await p;

    first.emit('exit', 1); // 崩溃 ⇒ 有界重启（spawn second）

    const chunks2: Buffer[] = [];
    second.stdin.on('data', (c: Buffer) => chunks2.push(c));
    const next = sup.request('lsp.hover', { language: 'typescript' });
    await tick(30);
    expect(calls).toBe(2);
    expect(sup.isRunning()).toBe(false); // 尚未握手
    expect(ipcFrames(chunks2)).toHaveLength(0); // 未就绪前不早写请求

    second.stdout.write(startupLine()); // 重启就绪
    await waitFor(() =>
      ipcFrames(chunks2).some((f) => f.method === 'lsp.hover')
    );
    const reqId = String(
      ipcFrames(chunks2).find((f) => f.method === 'lsp.hover')!.id
    );
    second.stdout.write(
      encodeFrame({ id: reqId, success: true, result: 'AFTER_RESTART' }) + '\n'
    );
    await expect(next).resolves.toMatchObject({ result: 'AFTER_RESTART' });
    expect(sup.getRestarts()).toBe(1);
    sup.stop();
  });
});

describe('S3-④ 开关关 ⇒ 逐字等价现状', () => {
  const ENV_LSP = 'FEATURE_LSP';
  let savedLsp: string | undefined;
  beforeEach(() => {
    savedLsp = process.env[ENV_LSP];
    process.env[ENV_LSP] = 'true'; // 打开核心 LSP 工具，使条件工具进入生效视图
    delete process.env.FEATURE_TOOL_SIDECAR_LSP;
  });
  afterEach(() => {
    if (savedLsp === undefined) delete process.env[ENV_LSP];
    else process.env[ENV_LSP] = savedLsp;
  });

  it('开关关 ⇒ lsp 由内置 loader 产出（非侧车适配器）', () => {
    const fakeFactory = {
      create: (key: string) => ({
        name: key === 'createLSPTool' ? 'lsp' : key,
      }),
    } as unknown as ToolFactory;
    const tools = getBuiltinToolLoaders()
      .map((loader) => loader(fakeFactory))
      .filter((t): t is NonNullable<typeof t> => t !== null);
    const lsp = tools.find((t) => (t as { name?: string }).name === 'lsp');
    expect(lsp).toBeDefined();
    expect(lsp).not.toBeInstanceOf(SidecarLspTool);
  });
});

describe('S3 真实进程级（假 LS）：spawn → 握手 → initialize → hover → 取消 → 崩溃 → 重启 → 成功 → stop', () => {
  const logPath = join(tmpdir(), `fake-ls-s3-${process.pid}-${Date.now()}.log`);
  const children: ChildProcess[] = [];
  let sup: ToolSidecarSupervisor | null = null;

  afterEach(() => {
    sup?.stop();
    for (const c of children) {
      try {
        c.kill();
      } catch {
        // 已退出
      }
    }
    try {
      rmSync(logPath, { force: true });
    } catch {
      // 忽略
    }
  });

  it('完整链路（含取消下传 $/cancelRequest 与有界重启）', async () => {
    const readLog = (): string => {
      try {
        return readFileSync(logPath, 'utf8');
      } catch {
        return '';
      }
    };

    sup = new ToolSidecarSupervisor({
      startupTimeoutMs: 20_000,
      maxRestarts: 3,
      spawnFn: (cmd, args, opts) => {
        const c = spawn(cmd, args, opts as never);
        children.push(c);
        return c;
      },
    });
    await sup.start();
    expect(children.length).toBe(1);

    // initialize：假 LS 挂起 hover + 记录下发帧
    const init = await sup.request('lsp.initialize', {
      language: 'typescript',
      serverPath: process.execPath,
      serverArgs: [fakeLsScript, '--hang-hover', '--log', logPath],
    });
    expect(init.success).toBe(true);

    // 取消下传：hover 在飞 ⇒ abort ⇒ cancel 帧 ⇒ 侧车 ⇒ LS 收 $/cancelRequest
    const ctrl = new AbortController();
    const hoverP = sup.request(
      'lsp.hover',
      {
        language: 'typescript',
        document: 'const x = 1;\n',
        position: { line: 0, character: 6 },
      },
      ctrl.signal
    );
    await waitFor(() => readLog().includes('hover:'), 8000);
    ctrl.abort();
    await expect(hoverP).rejects.toThrow('取消');
    await waitFor(() => readLog().includes('cancel:'), 8000);
    expect(readLog()).toContain('cancel:');
    expect(sup.isRunning()).toBe(true); // 侧车主进程存活

    // 崩溃 ⇒ 有界重启（再次 spawn）
    const before = children.length;
    children[0].kill();
    await waitFor(() => children.length > before, 8000);
    await waitFor(() => sup!.isRunning(), 15_000);
    expect(sup.getRestarts()).toBe(1);

    // 重启后下一次调用成功（新侧车 → 新 LS，不带 hang）
    const init2 = await sup.request('lsp.initialize', {
      language: 'typescript',
      serverPath: process.execPath,
      serverArgs: [fakeLsScript],
    });
    expect(init2.success).toBe(true);
    const hover2 = await sup.request('lsp.hover', {
      language: 'typescript',
      document: 'const x = 1;\n',
      position: { line: 0, character: 6 },
    });
    expect(hover2.result).toBe('FAKE_HOVER');
  }, 60_000);
});
