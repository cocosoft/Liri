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
 * ① P2 —— 发现面 sidecar **监督器**单测（2026-10-10）。
 *
 * 用**假 ChildProcess**（PassThrough stdio + EventEmitter exit）注入 `spawnFn`，
 * **不 spawn 真实进程**。锁定：就绪握手（读端口）/ 版本不兼容 fail-closed /
 * 快照推送 / `stop()` 不重启 / 意外退出有界重启。
 */
import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import {
  DiscoverySidecarSupervisor,
  isDiscoverySidecarEnabled,
  ENV_DISCOVERY_SIDECAR,
} from '../../../../src/infrastructure/http/a2a/DiscoverySidecarSupervisor';
import {
  SIDECAR_IPC_PROTOCOL_VERSION,
  SIDECAR_STARTUP_TYPE,
  encodeFrame,
  decodeFrame,
} from '../../../../src/utils/sidecarIpc';
import type { A2ADiscoverySnapshot } from '../../../../src/infrastructure/http/a2a/discoverySurface';
import type { A2AAgentCard } from '../../../../src/types/a2a';

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

const SNAP: A2ADiscoverySnapshot = {
  card: { name: 'Liri' } as unknown as A2AAgentCard,
  etag: 'W/"1"',
  delegatorReady: false,
};

describe('① P2 监督器：就绪握手', () => {
  it('读 startup 帧的实际端口 ⇒ getPort()', async () => {
    const fake = new FakeChild();
    const sup = new DiscoverySidecarSupervisor({
      spawnFn: () => asChild(fake),
    });
    const p = sup.start();
    fake.stdout.write(
      encodeFrame({
        type: SIDECAR_STARTUP_TYPE,
        protocolVersion: SIDECAR_IPC_PROTOCOL_VERSION,
        port: 4321,
      }) + '\n'
    );
    expect(await p).toBe(4321);
    expect(sup.getPort()).toBe(4321);
    sup.stop();
  });

  it('版本不兼容 ⇒ fail-closed 拒绝启动', async () => {
    const fake = new FakeChild();
    const sup = new DiscoverySidecarSupervisor({
      spawnFn: () => asChild(fake),
    });
    const p = sup.start();
    fake.stdout.write(
      encodeFrame({
        type: SIDECAR_STARTUP_TYPE,
        protocolVersion: 99,
        port: 1,
      }) + '\n'
    );
    await expect(p).rejects.toThrow('版本不兼容');
  });
});

describe('① P2 监督器：快照推送 / 停止 / 重启', () => {
  it('pushSnapshot ⇒ 写 notify 帧（event=snapshot）', async () => {
    const fake = new FakeChild();
    const sup = new DiscoverySidecarSupervisor({
      spawnFn: () => asChild(fake),
    });
    const p = sup.start();
    fake.stdout.write(
      encodeFrame({
        type: SIDECAR_STARTUP_TYPE,
        protocolVersion: SIDECAR_IPC_PROTOCOL_VERSION,
        port: 5000,
      }) + '\n'
    );
    await p;

    const chunks: Buffer[] = [];
    fake.stdin.on('data', (c: Buffer) => chunks.push(c));
    sup.pushSnapshot(SNAP);
    await tick();

    const firstLine = Buffer.concat(chunks).toString().split('\n')[0];
    expect(decodeFrame(firstLine)).toEqual({
      type: 'notify',
      event: 'snapshot',
      data: SNAP,
    });
    sup.stop();
  });

  it('stop() ⇒ kill 子进程且**退出不再重启**', async () => {
    let calls = 0;
    const fake = new FakeChild();
    const sup = new DiscoverySidecarSupervisor({
      spawnFn: () => {
        calls += 1;
        return asChild(fake);
      },
    });
    const p = sup.start();
    fake.stdout.write(
      encodeFrame({
        type: SIDECAR_STARTUP_TYPE,
        protocolVersion: SIDECAR_IPC_PROTOCOL_VERSION,
        port: 6000,
      }) + '\n'
    );
    await p;

    sup.stop();
    expect(fake.killed).toBe(true);
    fake.emit('exit', 0); // 停止后的退出事件不应触发重启
    await tick(20);
    expect(calls).toBe(1);
    expect(sup.getPort()).toBeNull();
  });

  it('意外退出 ⇒ 有界重启（再次 spawn）', async () => {
    let calls = 0;
    const first = new FakeChild();
    const second = new FakeChild();
    const sup = new DiscoverySidecarSupervisor({
      startupTimeoutMs: 30,
      maxRestarts: 2,
      spawnFn: () => {
        calls += 1;
        return asChild(calls === 1 ? first : second);
      },
    });
    const p = sup.start();
    first.stdout.write(
      encodeFrame({
        type: SIDECAR_STARTUP_TYPE,
        protocolVersion: SIDECAR_IPC_PROTOCOL_VERSION,
        port: 7000,
      }) + '\n'
    );
    await p;

    first.emit('exit', 1); // 意外退出
    await tick(40);
    expect(calls).toBe(2); // 已重启一次
    sup.stop();
  });
});

describe('① P3 监督器：反向 RPC（a2a.delegate）', () => {
  it('子进程请求委派 ⇒ 主进程内核执行并回 success 帧', async () => {
    const fake = new FakeChild();
    const sup = new DiscoverySidecarSupervisor({
      spawnFn: () => asChild(fake),
      delegate: async (message) => ({
        completed: true,
        task: { id: 't1', message },
      }),
    });
    const p = sup.start();
    fake.stdout.write(
      encodeFrame({
        type: SIDECAR_STARTUP_TYPE,
        protocolVersion: SIDECAR_IPC_PROTOCOL_VERSION,
        port: 8100,
      }) + '\n'
    );
    await p;

    const chunks: Buffer[] = [];
    fake.stdin.on('data', (c: Buffer) => chunks.push(c));
    fake.stdout.write(
      encodeFrame({
        id: 'r1',
        method: 'a2a.delegate',
        params: { message: 'hello', agentId: 'a' },
      }) + '\n'
    );
    await tick(20);

    const frame = decodeFrame(Buffer.concat(chunks).toString().split('\n')[0]);
    expect(frame).toEqual({
      id: 'r1',
      success: true,
      result: { completed: true, task: { id: 't1', message: 'hello' } },
    });
    sup.stop();
  });

  it('未注入委派执行器 ⇒ 回 success:false（如实未就绪）', async () => {
    const fake = new FakeChild();
    const sup = new DiscoverySidecarSupervisor({
      spawnFn: () => asChild(fake),
    });
    const p = sup.start();
    fake.stdout.write(
      encodeFrame({
        type: SIDECAR_STARTUP_TYPE,
        protocolVersion: SIDECAR_IPC_PROTOCOL_VERSION,
        port: 8101,
      }) + '\n'
    );
    await p;

    const chunks: Buffer[] = [];
    fake.stdin.on('data', (c: Buffer) => chunks.push(c));
    fake.stdout.write(
      encodeFrame({
        id: 'r2',
        method: 'a2a.delegate',
        params: { message: 'x' },
      }) + '\n'
    );
    await tick(20);

    const frame = decodeFrame(
      Buffer.concat(chunks).toString().split('\n')[0]
    ) as Record<string, unknown>;
    expect(frame.id).toBe('r2');
    expect(frame.success).toBe(false);
    sup.stop();
  });
});

describe('① P2 开关', () => {
  it('默认关（未设 env）', () => {
    const prev = process.env[ENV_DISCOVERY_SIDECAR];
    delete process.env[ENV_DISCOVERY_SIDECAR];
    expect(isDiscoverySidecarEnabled()).toBe(false);
    if (prev !== undefined) process.env[ENV_DISCOVERY_SIDECAR] = prev;
  });

  it("env='true' ⇒ 开", () => {
    const prev = process.env[ENV_DISCOVERY_SIDECAR];
    process.env[ENV_DISCOVERY_SIDECAR] = 'true';
    expect(isDiscoverySidecarEnabled()).toBe(true);
    if (prev === undefined) delete process.env[ENV_DISCOVERY_SIDECAR];
    else process.env[ENV_DISCOVERY_SIDECAR] = prev;
  });
});
