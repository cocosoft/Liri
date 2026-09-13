// MIT License
// Copyright (c) 2026 Liri
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
 * harness 取流契约回归（O43 次生项加固，2026-09-13）
 *
 * 守护的**具体缺陷**：`streamChat` 对 `[DONE]` 只 `continue` 不退出（runner.ts 原 :135）——
 * 后端发完终止标记却不关连接时，取流会一直读到期超时（D2 评测表现为"挂住"，与真根因 O43
 * 叠加时无法区分）。修复后：`[DONE]` 即停止取流并取消剩余读取，且**不丢同一批次的 usage**
 * （后端真实顺序为 usage 分片 → `[DONE]`，见 chat-handlers.ts:826 → :843）。
 *
 * 不复用 `MockLLMServer`：其契约是"发完 `[DONE]` 即 `controller.close()`"，
 * 无法表达本用例需要的"发了终止标记但连接不关"。此处只沿用其 `Bun.serve` 类型桥接写法。
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { streamChat } from '../../src/evals/runner';

/** Bun.serve 返回的 Server 最小形状（项目不引入 @types/bun，本地声明避免全局类型污染） */
interface BunServer {
  port: number;
  stop(closeActiveConnections?: boolean): void;
}

/** 启动一个"发完 [DONE] 但永不关闭连接"的 SSE 后端 */
function startNeverClosingSseServer(): { baseUrl: string; stop: () => void } {
  const server = (
    Bun as unknown as {
      serve(options: {
        port: number;
        hostname: string;
        fetch: (req: Request) => Response;
      }): BunServer;
    }
  ).serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (req: Request) => {
      const path = new URL(req.url).pathname;
      if (!path.endsWith('/chat/completions')) {
        // 其余端点（工具调用轨迹查询）走非 200：本用例只关心取流本身
        return new Response('not found', { status: 404 });
      }
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n' +
                'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":11,"completion_tokens":22}}\n\n' +
                'data: [DONE]\n\n'
            )
          );
          // 故意不 close()：模拟"发了终止标记但连接不关"的后端
        },
      });
      return new Response(body, {
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  });

  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    stop: () => {
      server.stop(true);
    },
  };
}

describe('harness 取流：SSE [DONE] 短路', () => {
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    stop = undefined;
  });

  test('后端发完 [DONE] 却不关连接时仍及时返回，且不丢文本与用量', async () => {
    const server = startNeverClosingSseServer();
    stop = server.stop;

    const startedAt = Date.now();
    const outcome = await streamChat(
      server.baseUrl,
      'eval-session',
      'test-model',
      '你好',
      5_000
    );
    const elapsedMs = Date.now() - startedAt;

    expect(outcome.text).toBe('你好');
    expect(outcome.promptTokens).toBe(11);
    expect(outcome.completionTokens).toBe(22);
    // 修复前：会一直读到 5s 的 AbortSignal 超时（抛错/超时失败）；修复后：收到 [DONE] 即返回
    expect(elapsedMs).toBeLessThan(3_000);
  });
});
