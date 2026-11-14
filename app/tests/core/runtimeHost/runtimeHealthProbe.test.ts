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

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import {
  getRuntimeHealthSnapshot,
  probeHealthWithBackoff,
  startRuntimeHealthProbe,
  stopRuntimeHealthProbe,
} from '@openliri/infra/runtimeHost/RuntimeHealthProbe';

let tmpDir: string;

const healthFile = (): string => path.join(tmpDir, 'runtime-health.json');
const previousHealthFile = (): string =>
  path.join(tmpDir, 'runtime-health-prev.jsonl');

/** 读取 prev 的行（一进程一行） */
const previousLines = (): Array<Record<string, unknown>> =>
  fs
    .readFileSync(previousHealthFile(), 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('waitFor 超时');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-health-probe-'));
});

afterAll(() => {
  stopRuntimeHealthProbe();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('RuntimeHealthProbe — 运行时心跳', () => {
  test('启动后立即落盘心跳，字段完整', async () => {
    startRuntimeHealthProbe({ intervalMs: 50, dataDir: tmpDir });
    await waitFor(() => fs.existsSync(healthFile()));

    const snapshot = JSON.parse(
      fs.readFileSync(healthFile(), 'utf-8')
    ) as Record<string, unknown>;
    expect(snapshot.pid).toBe(process.pid);
    expect(snapshot.startedAt).toBeTruthy();
    expect(typeof snapshot.uptimeMs).toBe('number');
    expect(Number(snapshot.rssMb)).toBeGreaterThan(0);
    expect(Number(snapshot.heapUsedMb)).toBeGreaterThan(0);
    expect(typeof snapshot.eventLoopLagMs).toBe('number');
  });

  test('重复启动幂等：不重置 startedAt', () => {
    const startedAt = getRuntimeHealthSnapshot().startedAt;
    startRuntimeHealthProbe({ intervalMs: 999, dataDir: tmpDir });
    expect(getRuntimeHealthSnapshot().startedAt).toBe(startedAt);
  });

  // 2026-11-08（pid 1976 取证）：prev 曾是覆盖写 ⇒ 下一次启动即抹掉上一次的末次心跳。
  // 改为 JSONL 追加后，重启风暴下每轮各留一行。
  test('启动时把上一次进程的末次心跳**追加**到 prev（不覆盖既有记录）', async () => {
    stopRuntimeHealthProbe();
    fs.rmSync(previousHealthFile(), { force: true });
    fs.writeFileSync(
      healthFile(),
      JSON.stringify({ pid: 999999, rssMb: 2048, at: '2026-11-08T05:00:00Z' })
    );

    startRuntimeHealthProbe({ intervalMs: 50, dataDir: tmpDir });

    const first = previousLines();
    expect(first.length).toBe(1);
    expect(first[0]!.pid).toBe(999999);
    expect(first[0]!.rssMb).toBe(2048);

    // 心跳落盘是异步的（writeFileAtomic）⇒ 轮询等待覆盖为当前进程
    const readPid = (): number =>
      (JSON.parse(fs.readFileSync(healthFile(), 'utf-8')) as { pid: number })
        .pid;
    await waitFor(() => readPid() === process.pid);
    expect(readPid()).toBe(process.pid);

    // 第二次启动 ⇒ 追加第二行，第一行仍在
    stopRuntimeHealthProbe();
    fs.writeFileSync(
      healthFile(),
      JSON.stringify({ pid: 888888, rssMb: 1024, at: '2026-11-08T06:00:00Z' })
    );
    startRuntimeHealthProbe({ intervalMs: 50, dataDir: tmpDir });

    const both = previousLines();
    expect(both.length).toBe(2);
    expect(both[0]!.pid).toBe(999999);
    expect(both[1]!.pid).toBe(888888);
    expect(both[1]!.rssMb).toBe(1024);
  });
});

describe('probeHealthWithBackoff — 就绪探测', () => {
  test('健康端点可用时首次即通过', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"status":"ok"}');
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve())
    );
    const port = (server.address() as AddressInfo).port;

    try {
      const result = await probeHealthWithBackoff(`http://127.0.0.1:${port}`, {
        maxAttempts: 3,
        initialDelayMs: 5,
        timeoutMs: 1000,
      });
      expect(result.ok).toBe(true);
      expect(result.attempts).toBe(1);
      expect(result.httpStatus).toBe(200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('端口不可达时退避耗尽并给出错误', async () => {
    const probe = http.createServer((_req, res) => res.end('ok'));
    await new Promise<void>((resolve) =>
      probe.listen(0, '127.0.0.1', () => resolve())
    );
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const result = await probeHealthWithBackoff(`http://127.0.0.1:${port}`, {
      maxAttempts: 2,
      initialDelayMs: 5,
      maxDelayMs: 10,
      timeoutMs: 300,
    });
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.error).toBeTruthy();
  });
});
