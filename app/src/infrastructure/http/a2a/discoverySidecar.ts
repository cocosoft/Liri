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
 * A2A **只读发现面 sidecar 进程**（① P2，2026-10-10）。
 *
 * 方案：`dev_docs/20261010/A2A-MCP网关进程级侧车隔离-设计方案-20261010.md` §8.1（P2）。
 *
 * 职责：**独立进程**在**自有端口**上提供 `/.well-known/agent-card.json` + `/v1/a2a/health`
 * 的**只读**响应 ⇒ 主进程停/启不影响发现面（当本进程被**独立/常驻**拉起时）。
 *
 * 通信（单一契约，P1）：stdio 换行分隔 JSON ——
 * - 出：`{type:'startup', protocolVersion, pid, port}`（就绪握手，含**实际绑定端口**）；
 * - 出：`{type:'heartbeat', at}`（周期心跳）；
 * - 入：`{type:'notify', event:'snapshot', data:{card,etag,delegatorReady}}`（主进程推送快照）。
 *
 * 鉴权：**复用**同模块 `handlers/routes/a2a-routes.isA2AAuthorized`（x-api-key / Bearer +
 * `A2A_API_KEYS`，fail-closed）⇒ 不与主进程分叉判据（CS01）。
 *
 * 边界（如实）：**不**承载委派/任务端点（需 CoreAPI 句柄，属 P3）；**端口独立于主进程 HTTP 端口**
 * （单端口无法被两进程同时监听，除非加前置代理 —— 本轮不做）。
 */
import http from 'node:http';
import readline from 'node:readline';
import { getLogger } from '@modules/monitoring';
import { isA2AAuthorized } from '../handlers/routes/a2a-routes';
import {
  SIDECAR_IPC_PROTOCOL_VERSION,
  encodeFrame,
  decodeFrame,
  buildHeartbeat,
} from '@modules/utils/sidecarIpc';
import {
  handleDiscoveryRequest,
  type A2ADiscoverySnapshot,
} from './discoverySurface';

const logger = getLogger('infra:http:a2a:discoverySidecar');

/** 环境变量：sidecar 监听主机（默认仅本机） */
const ENV_HOST = 'A2A_DISCOVERY_HOST';
/** 环境变量：sidecar 端口（默认 0 = 由 OS 分配，避免与主进程端口冲突） */
const ENV_PORT = 'A2A_DISCOVERY_PORT';
/** 心跳周期（ms） */
const HEARTBEAT_MS = 15_000;
/** ① P3：委派反向 RPC 超时（ms）——大于主进程的有界等待上限（默认 15s），留足余量 */
const DELEGATE_IPC_TIMEOUT_MS = 60_000;

export interface DiscoverySidecarOptions {
  host?: string;
  /** 0 = 由 OS 分配（默认）；边界如实：独立于主进程端口 */
  port?: number;
  heartbeatMs?: number;
  /** 测试/内嵌：初始快照（缺省等待主进程推送） */
  snapshot?: A2ADiscoverySnapshot | null;
}

/** ① P3：委派转发签名（经 IPC 回主进程内核执行） */
export type SidecarDelegate = (
  message: string,
  agentId?: string
) => Promise<{ status: number; body: unknown }>;

export interface DiscoveryServerDeps {
  getSnapshot: () => A2ADiscoverySnapshot | null;
  /** 未注入 ⇒ `POST /v1/a2a/tasks` 回 503（如实"未就绪"） */
  delegate?: SidecarDelegate;
}

/** ① P3：委派端点路径（与 `a2a-routes.ts` 的 `TASKS_PATH` 同口径） */
const TASKS_PATH = '/v1/a2a/tasks';

function writeJson(
  res: http.ServerResponse,
  status: number,
  body: unknown
): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c: Buffer) => (data += c.toString()));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/** 启动发现面 HTTP 服务（纯 socket + 纯响应表；可单测） */
export function startDiscoveryServer(
  opts: DiscoverySidecarOptions,
  deps: DiscoveryServerDeps
): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const url = (req.url ?? '').split('?')[0];
    const method = req.method ?? 'GET';

    // ① P3：委派端点（非只读）—— 经 IPC 回主进程内核执行，本进程**不自建 CoreAPI**
    if (method === 'POST' && url === TASKS_PATH) {
      if (!isA2AAuthorized(req)) {
        writeJson(res, 401, {
          error: { message: 'A2A 未授权：需 x-api-key 或 Bearer' },
        });
        return;
      }
      if (!deps.delegate) {
        res.setHeader('Retry-After', '5');
        writeJson(res, 503, {
          error: { message: 'A2A 委派后端未就绪（主进程未接入）' },
        });
        return;
      }
      void (async () => {
        try {
          const body = JSON.parse((await readBody(req)) || '{}') as Record<
            string,
            unknown
          >;
          const message =
            typeof body.message === 'string' ? body.message.trim() : '';
          if (!message) {
            writeJson(res, 400, {
              error: { message: 'message 必填且不能为空' },
            });
            return;
          }
          const agentId =
            typeof body.agentId === 'string' ? body.agentId : undefined;
          const out = await deps.delegate!(message, agentId);
          writeJson(res, out.status, out.body);
        } catch (err) {
          writeJson(res, 400, { error: { message: String(err) } });
        }
      })();
      return;
    }

    const result = handleDiscoveryRequest({
      method,
      url,
      ifNoneMatch: req.headers['if-none-match'] as string | undefined,
      snapshot: deps.getSnapshot(),
    });

    if (!result.handled) {
      writeJson(res, 404, { error: { message: 'Not Found' } });
      return;
    }
    // 与主进程同源鉴权（fail-closed）；未带合法密钥 ⇒ 401
    if (!isA2AAuthorized(req)) {
      writeJson(res, 401, {
        error: {
          message: 'A2A 未授权：需 x-api-key 或 Bearer（A2A_API_KEYS）',
        },
      });
      return;
    }
    res.writeHead(result.status, result.headers ?? {});
    res.end(
      result.body === undefined ? undefined : JSON.stringify(result.body)
    );
  });

  const host = opts.host ?? process.env[ENV_HOST] ?? '127.0.0.1';
  const port = opts.port ?? Number(process.env[ENV_PORT] ?? 0) ?? 0;
  return new Promise<http.Server>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

/**
 * 运行 sidecar（既作**子进程**被主进程监督，也可**独立**启动）。
 * `import.meta.main` 时自动执行。
 */
export async function runDiscoverySidecar(
  opts: DiscoverySidecarOptions = {}
): Promise<{ port: number; close: () => Promise<void> }> {
  let snapshot: A2ADiscoverySnapshot | null = opts.snapshot ?? null;

  // ① P3：反向 RPC（sidecar → 主进程）；按 id 关联响应
  let reqSeq = 0;
  const pending = new Map<
    string,
    {
      resolve: (v: Record<string, unknown>) => void;
      reject: (e: Error) => void;
    }
  >();
  const request = (
    method: string,
    params: Record<string, unknown>,
    timeoutMs = DELEGATE_IPC_TIMEOUT_MS
  ): Promise<Record<string, unknown>> => {
    const id = `a2a_${++reqSeq}_${Date.now()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`主进程 IPC 超时：${method}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      process.stdout.write(
        encodeFrame({ id, method, params, fromChild: true })
      );
    });
  };

  const delegate: SidecarDelegate = async (message, agentId) => {
    const res = await request('a2a.delegate', { message, agentId });
    if (res.success !== true) {
      const err = (res.error ?? {}) as Record<string, unknown>;
      return {
        status: 503,
        body: { error: { message: String(err.message ?? '委派失败') } },
      };
    }
    const result = res.result as
      | { completed?: boolean; task?: unknown }
      | undefined;
    return { status: result?.completed ? 200 : 202, body: result?.task };
  };

  const server = await startDiscoveryServer(opts, {
    getSnapshot: () => snapshot,
    delegate,
  });
  const address = server.address();
  const port =
    typeof address === 'object' && address ? address.port : (opts.port ?? 0);

  // 就绪握手（P1 契约）：报出**实际绑定端口**
  process.stdout.write(
    encodeFrame({
      type: 'startup',
      protocolVersion: SIDECAR_IPC_PROTOCOL_VERSION,
      pid: process.pid,
      port,
    })
  );
  logger.info('A2A 发现面 sidecar 已就绪', { port });

  // 入站：快照推送（notify）+ 反向 RPC 响应（带 id）
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const frame = decodeFrame(line);
    if (!frame) return;
    if (frame.type === 'notify' && frame.event === 'snapshot') {
      const data = frame.data as A2ADiscoverySnapshot | undefined;
      if (data && typeof data === 'object') snapshot = data;
      return;
    }
    if (typeof frame.id === 'string') {
      const p = pending.get(frame.id);
      if (p) {
        pending.delete(frame.id);
        p.resolve(frame);
      }
    }
  });

  // 心跳
  const hbTimer = setInterval(() => {
    process.stdout.write(
      encodeFrame(buildHeartbeat() as unknown as Record<string, unknown>)
    );
  }, opts.heartbeatMs ?? HEARTBEAT_MS);
  hbTimer.unref?.();

  const close = async (): Promise<void> => {
    clearInterval(hbTimer);
    rl.close();
    await new Promise<void>((r) => server.close(() => r()));
  };
  return { port, close };
}

// 独立/子进程启动（`bun run src/infrastructure/http/a2a/discoverySidecar.ts`）
if (import.meta.main) {
  void runDiscoverySidecar().catch((err: unknown) => {
    logger.error('A2A 发现面 sidecar 启动失败', { error: String(err) });
    process.exit(1);
  });
}
