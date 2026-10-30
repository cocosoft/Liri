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
 * 工具侧车 **监督器**单测（S1 骨架）。
 *
 * 用**假 ChildProcess**（PassThrough stdio + EventEmitter exit）注入 `spawnFn`，
 * **不 spawn 真实进程**。锁定：就绪握手 / 版本不兼容 fail-closed / 就绪超时 /
 * request-response / 意外退出有界重启 / `stop()` 不再重启 / **崩溃 ⇒ pending 全拒（D5）**。
 */
import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { ChildProcess } from 'node:child_process';
import { context, trace, TraceFlags } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { ToolSidecarSupervisor } from '../../../src/tools/sidecar/ToolSidecarSupervisor';
import { runWithActiveSpan } from '../../../src/monitoring/tracing/traceContextInjector';
import {
  SIDECAR_IPC_PROTOCOL_VERSION,
  SIDECAR_STARTUP_TYPE,
  encodeFrame,
  decodeFrame,
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
const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms));

const startupFrame = (
  protocolVersion: number = SIDECAR_IPC_PROTOCOL_VERSION,
  pid = 1234
): string =>
  encodeFrame({ type: SIDECAR_STARTUP_TYPE, protocolVersion, pid }) + '\n';

describe('工具侧车监督器：就绪握手', () => {
  it('读 startup 帧 ⇒ 就绪（isRunning）', async () => {
    const fake = new FakeChild();
    const sup = new ToolSidecarSupervisor({ spawnFn: () => asChild(fake) });
    const p = sup.start();
    fake.stdout.write(startupFrame());
    await expect(p).resolves.toEqual({ pid: 1234 });
    expect(sup.isRunning()).toBe(true);
    sup.stop();
  });

  it('spawn 时注入父 PID（侧车据此在父进程消失后自清）', async () => {
    const fake = new FakeChild();
    let seenEnv: NodeJS.ProcessEnv | undefined;
    const sup = new ToolSidecarSupervisor({
      spawnFn: (_cmd, _args, opts) => {
        seenEnv = (opts as { env?: NodeJS.ProcessEnv }).env;
        return asChild(fake);
      },
    });
    const p = sup.start();
    fake.stdout.write(startupFrame());
    await expect(p).resolves.toEqual({ pid: 1234 });
    // 键名走产品前缀，值为**当前进程** PID（与 parentLiveness 的读取端同一契约）
    expect(seenEnv?.['LIRI_SIDECAR_PARENT_PID']).toBe(String(process.pid));
    sup.stop();
  });

  it('协议版本不兼容 ⇒ fail-closed 拒绝启动', async () => {
    const fake = new FakeChild();
    const killed: ChildProcess[] = [];
    const sup = new ToolSidecarSupervisor({
      spawnFn: () => asChild(fake),
      killTree: (child) => killed.push(child),
    });
    const p = sup.start();
    fake.stdout.write(startupFrame(99));
    await expect(p).rejects.toThrow('版本不兼容');
    // U-16 同类面：失败即强杀并解绑（不留半启动侧车）
    expect(killed).toEqual([asChild(fake)]);
    expect(sup.isRunning()).toBe(false);
  });

  it('无 startup 帧 ⇒ 就绪超时', async () => {
    const fake = new FakeChild();
    const killed: ChildProcess[] = [];
    const sup = new ToolSidecarSupervisor({
      spawnFn: () => asChild(fake),
      startupTimeoutMs: 20,
      killTree: (child) => killed.push(child),
    });
    await expect(sup.start()).rejects.toThrow('就绪超时');
    // U-16 同类面：超时同样强杀进程树（区别于旧实现只靠 GC/退出）
    expect(killed).toEqual([asChild(fake)]);
    expect(sup.isRunning()).toBe(false);
  });
});

describe('工具侧车监督器：request / notify', () => {
  it('request ⇒ 写 request 帧，响应对应 id ⇒ resolve', async () => {
    const fake = new FakeChild();
    const sup = new ToolSidecarSupervisor({ spawnFn: () => asChild(fake) });
    const p = sup.start();
    fake.stdout.write(startupFrame());
    await p;

    const chunks: Buffer[] = [];
    fake.stdin.on('data', (c: Buffer) => chunks.push(c));
    const req = sup.request('lsp.hover', { file: 'a.ts' });
    await tick();
    const reqFrame = decodeFrame(
      Buffer.concat(chunks).toString().split('\n')[0]
    )!;
    expect(reqFrame.method).toBe('lsp.hover');
    expect(reqFrame.params).toEqual({ file: 'a.ts' });

    fake.stdout.write(
      encodeFrame({ id: reqFrame.id, success: true, result: { ok: 1 } }) + '\n'
    );
    await expect(req).resolves.toEqual({
      id: reqFrame.id,
      success: true,
      result: { ok: 1 },
    });
    sup.stop();
  });

  it('需求帧 success:false ⇒ request reject（不伪造成功）', async () => {
    const fake = new FakeChild();
    const sup = new ToolSidecarSupervisor({ spawnFn: () => asChild(fake) });
    const p = sup.start();
    fake.stdout.write(startupFrame());
    await p;

    const chunks: Buffer[] = [];
    fake.stdin.on('data', (c: Buffer) => chunks.push(c));
    const req = sup.request('lsp.x');
    await tick();
    const reqFrame = decodeFrame(
      Buffer.concat(chunks).toString().split('\n')[0]
    )!;
    fake.stdout.write(
      encodeFrame({
        id: reqFrame.id,
        success: false,
        error: { message: 'boom' },
      }) + '\n'
    );
    await expect(req).rejects.toThrow('boom');
    sup.stop();
  });

  it('notify ⇒ 写 notify 帧（S3 取消下传复用）', async () => {
    const fake = new FakeChild();
    const sup = new ToolSidecarSupervisor({ spawnFn: () => asChild(fake) });
    const p = sup.start();
    fake.stdout.write(startupFrame());
    await p;

    const chunks: Buffer[] = [];
    fake.stdin.on('data', (c: Buffer) => chunks.push(c));
    sup.notify('cancel', { id: 'r1' });
    await tick();
    const frame = decodeFrame(Buffer.concat(chunks).toString().split('\n')[0]);
    expect(frame).toEqual({
      type: 'notify',
      event: 'cancel',
      data: { id: 'r1' },
    });
    sup.stop();
  });
});

describe('工具侧车监督器：崩溃隔离 / 重启 / 停止', () => {
  it('崩溃 ⇒ pending 全拒、主内核不抛（D5）', async () => {
    const fake = new FakeChild();
    const sup = new ToolSidecarSupervisor({
      spawnFn: () => asChild(fake),
      maxRestarts: 0,
      requestTimeoutMs: 50,
    });
    const p = sup.start();
    fake.stdout.write(startupFrame());
    await p;

    const req = sup.request('lsp.hover', {});
    await tick();
    // 侧车崩溃（未 stop）
    fake.emit('exit', 1);
    await expect(req).rejects.toThrow('工具侧车已退出');
    expect(sup.isRunning()).toBe(false);
  });

  it('意外退出 ⇒ 有界重启（再次 spawn）', async () => {
    let calls = 0;
    const first = new FakeChild();
    const second = new FakeChild();
    const sup = new ToolSidecarSupervisor({
      startupTimeoutMs: 20,
      maxRestarts: 2,
      spawnFn: () => {
        calls += 1;
        return asChild(calls === 1 ? first : second);
      },
    });
    const p = sup.start();
    first.stdout.write(startupFrame());
    await p;

    first.emit('exit', 1);
    await tick(40);
    expect(calls).toBe(2);
    expect(sup.getRestarts()).toBe(1);
    sup.stop();
  });

  it('stop() ⇒ kill 子进程且退出不再重启', async () => {
    let calls = 0;
    const fake = new FakeChild();
    const sup = new ToolSidecarSupervisor({
      spawnFn: () => {
        calls += 1;
        return asChild(fake);
      },
    });
    const p = sup.start();
    fake.stdout.write(startupFrame());
    await p;

    sup.stop();
    expect(fake.killed).toBe(true);
    fake.emit('exit', 0); // 停止后的退出事件不应触发重启
    await tick(20);
    expect(calls).toBe(1);
    expect(sup.isRunning()).toBe(false);
  });

  it('U-16 同类面：stop() 走**进程树强杀**（注入替身，不直接 child.kill）', async () => {
    const fake = new FakeChild();
    const killed: ChildProcess[] = [];
    const sup = new ToolSidecarSupervisor({
      spawnFn: () => asChild(fake),
      killTree: (child) => killed.push(child),
    });
    const p = sup.start();
    fake.stdout.write(startupFrame());
    await p;

    sup.stop();
    expect(killed).toEqual([asChild(fake)]);
    expect(fake.killed).toBe(false);
  });
});

describe('工具侧车监督器：请求帧 trace 上下文（§6-#6）', () => {
  const cm = new AsyncLocalStorageContextManager();
  cm.enable();
  context.setGlobalContextManager(cm);

  const span = trace.wrapSpanContext({
    traceId: '0af7651916cd43dd8448eb211c80319c',
    spanId: 'b7ad6b7169203331',
    traceFlags: TraceFlags.SAMPLED,
    isRemote: false,
  });

  const collectFrames = (fake: FakeChild): string[] => {
    const lines: string[] = [];
    fake.stdin.setEncoding('utf8');
    fake.stdin.on('data', (chunk: string) => {
      lines.push(...chunk.split('\n').filter((l) => l.trim().length > 0));
    });
    return lines;
  };

  it('无活动 span ⇒ 帧里没有 meta（形状与既有逐字节一致）；有 ⇒ 带 traceparent', async () => {
    const fake = new FakeChild();
    const lines = collectFrames(fake);
    const sup = new ToolSidecarSupervisor({ spawnFn: () => asChild(fake) });
    const started = sup.start();
    fake.stdout.write(startupFrame());
    await started;

    const plain = sup.request('lsp.hover', {});
    await tick();
    fake.stdout.write(
      encodeFrame({ id: 'toolsidecar_1', success: true, result: {} })
    );
    await plain;
    const first = decodeFrame(lines[0]) ?? {};
    expect(first.meta).toBeUndefined();
    expect(first.method).toBe('lsp.hover');

    const traced = runWithActiveSpan(span, () => sup.request('lsp.hover', {}));
    await tick();
    fake.stdout.write(
      encodeFrame({ id: 'toolsidecar_2', success: true, result: {} })
    );
    await traced;
    const second = decodeFrame(lines[1]) ?? {};
    expect(
      (second.meta as { traceparent?: string } | undefined)?.traceparent
    ).toBe('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01');

    sup.stop();
  });
});

describe('工具侧车监督器：进程登记表（§6-#5）', () => {
  const withPid = (fake: FakeChild, pid: number): FakeChild => {
    (fake as unknown as { pid?: number }).pid = pid;
    return fake;
  };

  it('就绪即登记、停止即注销（注入端口，不碰磁盘）', async () => {
    const calls: string[] = [];
    const fake = withPid(new FakeChild(), 4321);
    const sup = new ToolSidecarSupervisor({
      spawnFn: () => asChild(fake),
      registry: {
        register: (e) =>
          calls.push(`register:${e.pid}:${e.parentPid}:${e.script}`),
        unregister: (pid) => calls.push(`unregister:${pid}`),
      },
    });
    const started = sup.start();
    fake.stdout.write(startupFrame());
    await started;
    expect(calls).toEqual([`register:4321:${process.pid}:lspSidecar.ts`]);

    sup.stop();
    expect(calls).toEqual([
      `register:4321:${process.pid}:lspSidecar.ts`,
      'unregister:4321',
    ]);
  });

  it('崩溃退出 ⇒ 注销', async () => {
    const calls: string[] = [];
    const fake = withPid(new FakeChild(), 555);
    const sup = new ToolSidecarSupervisor({
      spawnFn: () => asChild(fake),
      maxRestarts: 0, // 不重启，只断言注销
      registry: {
        register: (e) => calls.push(`register:${e.pid}`),
        unregister: (pid) => calls.push(`unregister:${pid}`),
      },
    });
    const started = sup.start();
    fake.stdout.write(startupFrame());
    await started;

    fake.emit('exit', 1);
    await tick();
    expect(calls).toEqual(['register:555', 'unregister:555']);
  });

  it('无 pid（替身/异常 spawn）⇒ 不登记', async () => {
    const calls: string[] = [];
    const fake = new FakeChild();
    const sup = new ToolSidecarSupervisor({
      spawnFn: () => asChild(fake),
      registry: {
        register: (e) => calls.push(`register:${e.pid}`),
        unregister: (pid) => calls.push(`unregister:${pid}`),
      },
    });
    const started = sup.start();
    fake.stdout.write(startupFrame());
    await started;
    sup.stop();
    expect(calls).toEqual([]);
  });
});

describe('工具侧车监督器：打包面（spec §13.5）', () => {
  it('侧车脚本不存在（--compile 未随包分发入口）⇒ 抛错 fail-closed 且**零 spawn**', async () => {
    let spawned = 0;
    const sup = new ToolSidecarSupervisor({
      scriptPath: join(tmpdir(), '__no_such_sidecar_entry__.ts'),
      spawnFn: () => {
        spawned += 1;
        return asChild(new FakeChild());
      },
    });
    await expect(sup.start()).rejects.toThrow('工具侧车脚本不存在');
    expect(spawned).toBe(0);
    expect(sup.isRunning()).toBe(false);
  });

  it('默认脚本路径（同目录 lspSidecar.ts）在源码树内存在 ⇒ 不被该守卫误伤', () => {
    const script = fileURLToPath(
      new URL('../../../src/tools/sidecar/lspSidecar.ts', import.meta.url)
    );
    expect(existsSync(script)).toBe(true);
  });
});
