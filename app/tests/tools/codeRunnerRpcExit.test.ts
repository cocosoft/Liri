/**
 * CodeRunner RPC 子进程的**退出结算兜底**（2026-11-15）。
 *
 * 背景（CI 实证）：`G1-A2` 用例在 macOS runner 偶发卡到 20s 测试超时 —— 子进程其实已经
 * 退出、`exitCode` 也可读，但 `exit` 事件没有投递 ⇒ `runRpcChildProcess` 永不结算。
 * 这里用假 child 把三种路径钉住（不依赖真实进程时序，三平台同构）：
 *  ① 事件缺失但 `exitCode` 可读 ⇒ 轮询补齐；
 *  ② 事件正常投递 ⇒ 行为不变（立即结算并带出退出码）；
 *  ③ 进程永不退出 ⇒ 超过 `timeoutMs + 两阶段 kill 宽限` 后强制判超时（Promise 不得永久挂起）。
 */
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'bun:test';

import type { ChildProcess } from 'node:child_process';

import { runRpcChildProcess } from '../../src/tools/CodeRunner/CrossPlatformRunner';
import { CodeRunnerBridge } from '../../src/tools/CodeRunner/RuntimeBridge';

function makeBridge(): CodeRunnerBridge {
  return new CodeRunnerBridge({
    sessionId: 'rpc-exit-test',
    executeTool: async () => ({ ok: true }),
    readContext: async () => ({ unavailable: true }),
    writeEvent: async () => undefined,
    toolWhitelist: new Set<string>(),
  });
}

/** 最小假子进程：只提供 `runRpcChildProcess` 真正读取的字段/事件 */
class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  killed = false;
  pid: number | undefined = undefined;
  stdout = null;
  stderr = null;
  kill(): boolean {
    this.killed = true;
    return true;
  }
}

function fakeChild(): { child: ChildProcess; raw: FakeChild } {
  const raw = new FakeChild();
  return { child: raw as unknown as ChildProcess, raw };
}

describe('runRpcChildProcess 退出结算兜底', () => {
  it('exitCode 已可读但 exit 事件缺失 ⇒ 轮询补齐并带出退出码', async () => {
    const { child, raw } = fakeChild();
    const pending = runRpcChildProcess(child, {
      bridge: makeBridge(),
      timeoutMs: 5_000,
    });

    // 模拟「进程已退出、事件未投递」：只改状态，不发事件
    raw.exitCode = 125;

    const res = await pending;
    expect(res.exitCode).toBe(125);
    expect(res.status).toBe('failed');
  }, 5_000);

  it('exit 事件正常投递 ⇒ 立即结算（既有行为不变）', async () => {
    const { child, raw } = fakeChild();
    const pending = runRpcChildProcess(child, {
      bridge: makeBridge(),
      timeoutMs: 5_000,
    });

    raw.emit('exit', 0, null);

    const res = await pending;
    expect(res.exitCode).toBe(0);
    expect(res.status).toBe('failed');
    expect(res.error).toBe('code runner exited without done()');
  }, 5_000);

  it('进程永不退出 ⇒ 宽限期后强制判超时，Promise 不挂起', async () => {
    const { child } = fakeChild();
    const startedAt = Date.now();

    const res = await runRpcChildProcess(child, {
      bridge: makeBridge(),
      timeoutMs: 150,
    });

    expect(res.status).toBe('timeout');
    expect(res.exitCode).toBeUndefined();
    // timeoutMs + 两阶段 kill 宽限 + 余量；只断言"有界"，不锁具体毫秒
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  }, 10_000);
});
