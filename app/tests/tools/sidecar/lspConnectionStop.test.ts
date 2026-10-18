/**
 * U-16 同类面（2026-10-18）：LSP 侧车的**进程树强杀**。
 *
 * 覆盖：
 * ① `stop()` 走注入的 `killTree`（不直接 `child.kill`）；
 * ② `stop()` 仍会结算在飞请求（initialize 挂起 ⇒ 显式拒绝，不悬挂）。
 */
import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { LspSidecarConnection } from '../../../src/tools/sidecar/lspConnection';

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

describe('U-16 同类面：LSP 侧车进程树强杀', () => {
  it('stop() ⇒ 走注入的 killTree，且不直接 child.kill', async () => {
    const fake = new FakeChild();
    const killed: ChildProcess[] = [];
    const connection = new LspSidecarConnection({
      language: 'typescript',
      serverPath: 'fake-language-server',
      spawnFn: () => asChild(fake),
      killTree: (child) => killed.push(child),
    });

    // initialize 无响应：start 会一直 pending，由 stop() 的 rejectAllPending 结算
    const starting = connection.start().catch(() => {});
    await Promise.resolve();

    await connection.stop();

    expect(killed).toEqual([asChild(fake)]);
    expect(fake.killed).toBe(false);
    // 在飞 request 被显式结算（start 的 catch 也会再调一次 stop，幂等）
    await starting;
  });

  it('缺省（未注入）⇒ 无 pid 的替身降级为 child.kill(SIGKILL)', async () => {
    const fake = new FakeChild();
    const connection = new LspSidecarConnection({
      language: 'typescript',
      serverPath: 'fake-language-server',
      spawnFn: () => asChild(fake),
    });

    const starting = connection.start().catch(() => {});
    await Promise.resolve();
    await connection.stop();

    expect(fake.killed).toBe(true);
    await starting;
  });
});
