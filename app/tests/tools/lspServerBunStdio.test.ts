/**
 * TOOLGOV-LSP-BUN-STDIO 回归（2026-10-12 · 工具治理 阶段 2 靶点 P1）。
 *
 * 缺陷：`LSPServer.start()` 直接调用 `this.process.stdin/stdout/stderr.setEncoding('utf8')`；
 * 而 **bun 的 `child_process` 流仅 stdout/stderr 提供 `setEncoding`**（`stdin.setEncoding` 为
 * `undefined`，实测 `spawn(...).stdin.setEncoding === undefined`）⇒ `start()` 抛
 * `setEncoding is not a function` ⇒ `status=ERROR` ⇒ `lsp` 工具起不来（默认关 + 无测试 ⇒ 潜伏）。
 *
 * 修复：`stdin` 仅用于写入，**不再对其调 `setEncoding`**（stdout/stderr 保留）。
 *
 * 本用例以**真实子进程**（`fixtures/fakeLspServer.js`，按 LSP 帧回包）断言：start 不抛 + 状态 RUNNING
 * + `send()` 写入与 stdout 帧解析端到端可用。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
  LSPServer,
  type LSPServerConfig,
} from '../../src/tools/lsp/LSPServer.js';
import { ServerStatus } from '../../src/tools/lsp/types/index.js';

const FIXTURE = join(import.meta.dir, 'fixtures/fakeLspServer.js');

/** 用当前运行时作为"语言服务器"可执行文件（跨平台），驱动假 LSP 夹具 */
const fakeLspConfig = (): LSPServerConfig => ({
  serverPath: process.execPath,
  serverArgs: [FIXTURE],
});

let server: LSPServer | undefined;

afterEach(async () => {
  await server?.stop().catch(() => {});
  server = undefined;
});

describe('TOOLGOV-LSP-BUN-STDIO：LSPServer 在 bun 下可启动 + 收发', () => {
  it('start() 不抛错（原先因 `stdin.setEncoding` 不可用而抛），状态为 RUNNING', async () => {
    server = new LSPServer(fakeLspConfig());
    await expect(server.start()).resolves.toBeUndefined();
    expect(server.getStatus()).toBe(ServerStatus.RUNNING);
  });

  it('send() 写入 + stdout 帧解析：请求 / 响应端到端可用', async () => {
    server = new LSPServer(fakeLspConfig());
    await server.start();

    const received = new Promise<string>((resolve) =>
      server!.onMessage(resolve)
    );
    server.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 42,
        method: 'initialize',
        params: {},
      })
    );

    const msg = await received;
    expect(JSON.parse(msg).id).toBe(42);
    expect(JSON.parse(msg).result).toEqual({ ok: true });
  }, 10000);
});
