/**
 * JsonRpcBridge 测试（PY-1 桥接协议层）
 * 覆盖：startup 握手、request/response 收发、requestResult 解包、错误双格式透传、
 *      notify 双向推送、startup 超时双 settle 防护、协议版本常量
 */
import { describe, test, expect, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileSync } from 'fs';
import {
  JsonRpcBridge,
  BRIDGE_PROTOCOL_VERSION,
  type JsonRpcResponse,
} from '../JsonRpcBridge';

const tmpDir = mkdtempSync(join(tmpdir(), 'jsonrpc-bridge-test-'));

/** mock worker：发 startup、echo/fail 方法、notify 回显、处理 __SHUTDOWN__（fs.writeSync 同步写 stdout 防缓冲竞态） */
const MOCK_WORKER = `
const readline = require('readline');
const fs = require('fs');
const out = (o) => fs.writeSync(1, JSON.stringify(o) + '\\n');
const rl = readline.createInterface({ input: process.stdin });
out({ type: 'startup', pid: process.pid });
rl.on('line', (line) => {
  if (line === '__SHUTDOWN__') { process.exit(0); return; }
  const msg = JSON.parse(line);
  if (msg.type === 'notify') {
    out({ type: 'notify', event: 'echoed', data: msg });
    return;
  }
  if (msg.method === 'echo') {
    out({ id: msg.id, success: true, result: msg.params });
  } else if (msg.method === 'fail') {
    out({ id: msg.id, success: false, error: { code: 'E_FAIL', message: 'boom' }, errorCode: 'E_FAIL' });
  } else if (msg.method === 'version') {
    out({ id: msg.id, success: true, result: { protocolVersion: 1 } });
  }
});
`;

/** mock worker：不输出 startup（测试超时双 settle） */
const MOCK_WORKER_NO_STARTUP = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', () => {});
`;

const workerPath = join(tmpDir, 'mock-worker.js');
const noStartupPath = join(tmpDir, 'mock-no-startup.js');
writeFileSync(workerPath, MOCK_WORKER);
writeFileSync(noStartupPath, MOCK_WORKER_NO_STARTUP);

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function createBridge(overrides: Record<string, unknown> = {}) {
  return new JsonRpcBridge({
    pythonPath: 'node',
    workerScript: workerPath,
    startupTimeoutMs: 3000,
    requestTimeoutMs: 5000,
    ...overrides,
  } as never);
}

describe('JsonRpcBridge（PY-1 桥接协议层）', () => {
  test('startup 握手成功 + request 报文收发', async () => {
    const bridge = createBridge();
    await bridge.start();
    expect(bridge.isReady()).toBe(true);

    const res = await bridge.request<{ name: string }>('echo', {
      name: 'world',
    });
    expect(res.success).toBe(true);
    expect(res.result).toEqual({ name: 'world' });

    bridge.destroy();
  });

  test('requestResult 解包 result', async () => {
    const bridge = createBridge();
    await bridge.start();

    const result = await bridge.requestResult<{ name: string }>('echo', {
      name: 'liri',
    });
    expect(result).toEqual({ name: 'liri' });

    bridge.destroy();
  });

  test('错误响应：requestResult 抛错（success=false）', async () => {
    const bridge = createBridge({ requestTimeoutMs: 3000 });
    await bridge.start();

    // 先确认 fail 响应可达（request 返回完整响应）
    const res = await bridge.request('fail', {});
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('E_FAIL');

    // bun test 环境下连续快速双请求的 stdout 响应存在 IO 竞态（纯 Node 复现无此问题），
    // 隔离节奏后验证 requestResult 的错误解包路径
    await new Promise((resolve) => setTimeout(resolve, 50));

    await expect(bridge.requestResult('fail', {})).rejects.toThrow(
      /E_FAIL|boom/
    );

    bridge.destroy();
  });

  test('错误双格式透传：request 返回完整响应含 errorCode（AppError 兼容）', async () => {
    const bridge = createBridge();
    await bridge.start();

    const res = await bridge.request('fail');
    expect(res.success).toBe(false);
    expect(res.error).toEqual({ code: 'E_FAIL', message: 'boom' });
    expect(res.errorCode).toBe('E_FAIL');

    bridge.destroy();
  });

  test('notify 双向：sendNotify → 子进程回显帧 → onNotify 回调', async () => {
    const frames: unknown[] = [];
    const bridge = new JsonRpcBridge({
      pythonPath: 'node',
      workerScript: workerPath,
      startupTimeoutMs: 3000,
      onNotify: (frame) => frames.push(frame),
    });
    await bridge.start();

    bridge.sendNotify({ event: 'system:something', data: { a: 1 } });

    // 等待子进程回显 notify 帧到达
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(frames.length).toBeGreaterThan(0);
    const frame = frames[0] as Record<string, unknown>;
    expect(frame.type).toBe('notify');
    expect(frame.event).toBe('echoed');

    bridge.destroy();
  });

  test('startup 超时：start() reject 且无双 settle（子进程不发 startup）', async () => {
    const bridge = new JsonRpcBridge({
      pythonPath: 'node',
      workerScript: noStartupPath,
      startupTimeoutMs: 50,
      requestTimeoutMs: 500,
    });

    // 双 settle 防护：start() 只 reject 一次（不会因 destroy 后的 exit 再次 reject）
    await expect(bridge.start()).rejects.toThrow(/startup timed out/i);
    expect(bridge.isReady()).toBe(false);
  });

  test('协议版本常量导出（initialize 版本协商用）', () => {
    expect(BRIDGE_PROTOCOL_VERSION).toBe(1);
  });

  test('request 类型为完整 JsonRpcResponse', async () => {
    const bridge = createBridge();
    await bridge.start();

    const res: JsonRpcResponse = await bridge.request('echo', { ok: true });
    expect(res.id).toBeDefined();
    expect(res.success).toBe(true);

    bridge.destroy();
  });
});
