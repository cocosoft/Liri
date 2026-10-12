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
 * 常驻 LSP 工具侧车 **进程入口**（S1 骨架，Tool Sidecar Isolation）。
 *
 * 方案：`.trae/specs/tool-sidecar-isolation.md` §5（IPC 帧契约）+ §11 切片 `S1`（T1.3）。
 *
 * 通信（单一契约 `@modules/utils/sidecarIpc`，禁第三套）：
 * - 出：`{type:'startup', protocolVersion, pid}`（就绪握手）；
 * - 出：`{type:'heartbeat', at}`（周期心跳）；
 * - 入：`{id, method, params}` ⇒ 出 `{id, success, result|error}`（request/response 分帧）；
 * - 入：`{type:'notify', event, data}`（S3 取消下传 `event:'cancel'` 在此消费）。
 *
 * **边界（如实）**：本切片（S1）仅落**骨架**——握手 + 心跳 + 分帧，**未接线任何 LSP 方法**；
 * 对收到的请求一律 **fail-closed** 回 `{success:false, error:{code:'NOT_IMPLEMENTED'}}`
 * （**不伪造成功**，CS03）。真实 LSP 查询由轨 B 常驻引擎（`app/src/lsp/**`）在 **S2/T2.2** 接入。
 */
import readline from 'node:readline';
import { getLogger } from '@modules/monitoring';
import {
  SIDECAR_IPC_PROTOCOL_VERSION,
  encodeFrame,
  decodeFrame,
  buildHeartbeat,
} from '@modules/utils/sidecarIpc';

const logger = getLogger('tools:sidecar:lsp');

export const LSP_SIDECAR_HEARTBEAT_MS = 15_000;

export interface LspSidecarOptions {
  /** 输入流（缺省 `process.stdin`；测试可注入） */
  input?: NodeJS.ReadableStream;
  /** 输出流（缺省 `process.stdout`；测试可注入） */
  output?: NodeJS.WritableStream;
  heartbeatMs?: number;
  pid?: number;
}

export interface LspSidecarHandle {
  stop(): void;
}

/**
 * 启动 LSP 侧车骨架：发 `startup` 握手、周期心跳、按 `sidecarIpc` 契约分帧。
 * 可注入流 ⇒ 单测**不真起进程**即可断言首帧。
 */
export function startLspSidecar(
  opts: LspSidecarOptions = {}
): LspSidecarHandle {
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  const pid = opts.pid ?? process.pid;

  // 就绪握手（P1 契约）：报出 pid + protocolVersion
  output.write(
    encodeFrame({
      type: 'startup',
      protocolVersion: SIDECAR_IPC_PROTOCOL_VERSION,
      pid,
    })
  );

  const rl = readline.createInterface({ input });
  rl.on('line', (line) => {
    const frame = decodeFrame(line);
    if (!frame) return; // 非 JSON / 调试输出 ⇒ 忽略该行
    if (frame.type === 'notify') return; // S3：取消下传（event='cancel'）在此消费
    if (typeof frame.id === 'string') {
      // S1 骨架：未实现任何 LSP 方法 ⇒ fail-closed 报错（不伪造成功，CS03）
      output.write(
        encodeFrame({
          id: frame.id,
          success: false,
          error: {
            code: 'NOT_IMPLEMENTED',
            message: 'LSP 侧车方法尚未接线（S2/T2.2）',
          },
        })
      );
    }
  });

  const hbTimer = setInterval(() => {
    output.write(
      encodeFrame(buildHeartbeat() as unknown as Record<string, unknown>)
    );
  }, opts.heartbeatMs ?? LSP_SIDECAR_HEARTBEAT_MS);
  hbTimer.unref?.();

  return {
    stop(): void {
      clearInterval(hbTimer);
      rl.close();
    },
  };
}

// 独立/子进程启动（`bun run src/tools/sidecar/lspSidecar.ts`）
if (import.meta.main) {
  startLspSidecar();
  logger.info('LSP 工具侧车已就绪（S1 骨架）', { pid: process.pid });
}
