/**
 * 工具 LSP 客户端「请求超时」回归（2026-10-12 · 工具治理 阶段 2 靶点 P1 前置小修）。
 *
 * 缺陷（阶段 2.1 盘点发现）：`tools/lsp/LSPClient.sendRequest` **无超时** ⇒ 服务器若既不响应
 * 也不退出，返回的 Promise **永不 settle**（`pendingRequests` 条目泄漏）⇒ 工具调用挂起。
 * 修复：`sendRequest` 加超时兜底（缺省 {@link LSP_REQUEST_TIMEOUT_MS}=30s；响应到达时清除定时器）；
 * `shutdown()` 关闭握手改**尽力而为**（超时不阻断 `stop()`/子进程回收）。
 *
 * 本用例以**桩**（打桩 `LSPServer.start/send`：不 spawn、只"吞掉"发送、从不回包）+ 注入**短超时**，
 * 断言"有限时间内 reject" —— 离线、确定、不依赖真实子进程。
 */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import {
  LSPClient,
  LSP_REQUEST_TIMEOUT_MS,
} from '../../src/tools/lsp/LSPClient.js';
import { LSPServer } from '../../src/tools/lsp/LSPServer.js';

let startSpy: ReturnType<typeof spyOn> | undefined;
let sendSpy: ReturnType<typeof spyOn> | undefined;

afterEach(() => {
  startSpy?.mockRestore();
  sendSpy?.mockRestore();
  startSpy = undefined;
  sendSpy = undefined;
});

/** 造一个"服务器从不回包"的 LSPClient（打桩：不 spawn、send 静默吞掉） */
function makeSilentClient(timeoutMs: number): LSPClient {
  startSpy = spyOn(LSPServer.prototype, 'start').mockResolvedValue(undefined);
  sendSpy = spyOn(LSPServer.prototype, 'send').mockImplementation(() => {});
  return new LSPClient({ serverPath: 'unused-in-test' }, timeoutMs);
}

describe('工具 LSP 客户端：请求超时兜底', () => {
  it('缺省超时常量为 30s（口径对齐 @modules/lsp）', () => {
    expect(LSP_REQUEST_TIMEOUT_MS).toBe(30_000);
  });

  it('服务器不响应 ⇒ initialize 在超时后 reject（不永久挂起）', async () => {
    const client = makeSilentClient(200);
    const t0 = Date.now();
    await expect(client.start()).rejects.toThrow(/timed out after 200ms/);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(sendSpy).toHaveBeenCalled(); // 确有发出请求，只是无人应答
  });

  it('sendRequest 超时后再次请求同样受限（无永久挂起累积）', async () => {
    const client = makeSilentClient(150);
    await expect(client.sendRequest('textDocument/hover', {})).rejects.toThrow(
      /timed out after 150ms/
    );
    await expect(client.sendRequest('textDocument/hover', {})).rejects.toThrow(
      /timed out after 150ms/
    );
  });
});
