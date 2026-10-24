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
 * 常驻 LSP 工具侧车 **进程入口**（S2："真接线"，Tool Sidecar Isolation）。
 *
 * 方案：`.trae/specs/tool-sidecar-isolation.md` §5（IPC 帧契约）+ §11 切片 `S2`（T2.1–T2.4）。
 *
 * 通信（单一契约 `@modules/utils/sidecarIpc`，禁第三套）：
 * - 出：`{type:'startup', protocolVersion, pid}`（就绪握手）；
 * - 出：`{type:'heartbeat', at}`（周期心跳）；
 * - 入：`{id, method, params}` ⇒ 出 `{id, success, result|error}`（request/response 分帧）；
 * - 入：`{type:'notify', event, data}`（S3 取消下传 `event:'cancel'` 在此消费）。
 *
 * 方法集（**最小可用能力面**，诚实覆盖）：
 * - `lsp.initialize` ⇒ 侧车**自身** `spawn`/持有真实 LS（见 `lspConnection.ts`）；
 * - `lsp.hover` / `lsp.definition` ⇒ 翻译为 LSP 查询并回结果（形状同内置工具面）；
 * - **其余方法一律 fail-closed** 回 `{success:false, error:{code:'NOT_IMPLEMENTED'}}`
 *   （**不伪造成功**，CS03）。
 *
 * 边界（如实）：侧车自持 LS 连接，**不引用** `tools/lsp/**`、`app/src/lsp/**`
 * （用户 2026-10-13 裁定 A：不收敛两轨、不触碰其源码）。
 */
import readline from 'node:readline';
import { getLogger } from '@modules/monitoring';
import { installParentLivenessGuard } from '@modules/utils/parentLiveness';
import {
  SIDECAR_IPC_PROTOCOL_VERSION,
  encodeFrame,
  decodeFrame,
  buildHeartbeat,
} from '@modules/utils/sidecarIpc';
import {
  LspSidecarConnection,
  resolveLanguageServerCommand,
  type LspConnectionFactory,
  type LspConnectionOptions,
  type LspConnectionPort,
  type LspPosition,
} from './lspConnection';

const logger = getLogger('tools:sidecar:lsp');

export const LSP_SIDECAR_HEARTBEAT_MS = 15_000;

export interface LspSidecarOptions {
  /** 输入流（缺省 `process.stdin`；测试可注入） */
  input?: NodeJS.ReadableStream;
  /** 输出流（缺省 `process.stdout`；测试可注入） */
  output?: NodeJS.WritableStream;
  heartbeatMs?: number;
  pid?: number;
  /** LSP 连接工厂（缺省真人 `LspSidecarConnection`；测试可注入假连接） */
  connectionFactory?: LspConnectionFactory;
}

export interface LspSidecarHandle {
  stop(): void;
}

/** 侧车 RPC 错误（携带 `code`，供 response 帧 `error.code`） */
class LspSidecarRpcError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'LspSidecarRpcError';
  }
}

type LspSessions = Map<string, LspConnectionPort>;

/**
 * 启动 LSP 侧车：发 `startup` 握手、周期心跳、按 `sidecarIpc` 契约分帧，并把
 * `lsp.<method>` 请求翻译为真实 LSP 查询。可注入流 / 连接工厂 ⇒ 单测**不真起进程**。
 */
export function startLspSidecar(
  opts: LspSidecarOptions = {}
): LspSidecarHandle {
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  const pid = opts.pid ?? process.pid;
  const factory: LspConnectionFactory =
    opts.connectionFactory ??
    ((o: LspConnectionOptions) => new LspSidecarConnection(o));
  const sessions: LspSessions = new Map();
  // S3：在飞请求 id ⇒ 取消句柄（收到 notify{cancel} 时中止对应连接请求）
  const inflight = new Map<string, AbortController>();

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
    if (frame.type === 'notify') {
      // S3 取消下传：`{type:'notify', event:'cancel', data:{id}}` ⇒ 中止在飞请求
      if (frame.event === 'cancel') {
        const data = toRecord(frame.data);
        if (typeof data.id === 'string') inflight.get(data.id)?.abort();
      }
      return;
    }
    if (typeof frame.id === 'string') {
      void handleRequest(frame, output, sessions, factory, inflight);
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
      for (const conn of sessions.values()) void conn.stop();
      sessions.clear();
    },
  };
}

function toRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function toPosition(v: unknown): LspPosition {
  const p = toRecord(v);
  return {
    line: typeof p.line === 'number' ? p.line : 0,
    character: typeof p.character === 'number' ? p.character : 0,
  };
}

function toStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string')
    : [];
}

/** 建立/复用某语言的连接（惰性；`serverPath` 覆盖仅用于测试/自定义 LS） */
function ensureConnection(
  language: string,
  params: Record<string, unknown>,
  sessions: LspSessions,
  factory: LspConnectionFactory
): LspConnectionPort {
  const existing = sessions.get(language);
  if (existing) return existing;

  const override =
    typeof params.serverPath === 'string' && params.serverPath
      ? params.serverPath
      : null;
  let serverPath: string;
  let serverArgs: string[];
  if (override) {
    serverPath = override;
    serverArgs = toStringArray(params.serverArgs);
  } else {
    if (!language) {
      throw new LspSidecarRpcError(
        'NOT_INITIALIZED',
        'LSP 侧车会话未初始化：请先 initialize 或提供 language'
      );
    }
    const cmd = resolveLanguageServerCommand(language);
    if (!cmd) {
      throw new LspSidecarRpcError(
        'UNSUPPORTED_LANGUAGE',
        `不支持的 LSP 语言：${language}`
      );
    }
    serverPath = cmd.serverPath;
    serverArgs = cmd.serverArgs;
  }

  const conn = factory({
    language,
    serverPath,
    serverArgs,
    cwd: typeof params.cwd === 'string' ? params.cwd : undefined,
  });
  sessions.set(language, conn);
  return conn;
}

async function ensureStarted(
  params: Record<string, unknown>,
  sessions: LspSessions,
  factory: LspConnectionFactory
): Promise<LspConnectionPort> {
  const language = String(params.language ?? '');
  const conn = ensureConnection(language, params, sessions, factory);
  await conn.start();
  return conn;
}

async function dispatch(
  action: string,
  params: Record<string, unknown>,
  sessions: LspSessions,
  factory: LspConnectionFactory,
  signal?: AbortSignal
): Promise<unknown> {
  switch (action) {
    case 'initialize': {
      const language = String(params.language ?? '');
      if (!language) {
        throw new LspSidecarRpcError(
          'INVALID_PARAMS',
          'initialize 需要 language'
        );
      }
      const conn = ensureConnection(language, params, sessions, factory);
      await conn.start();
      return { language, initialized: true };
    }
    case 'hover': {
      const conn = await ensureStarted(params, sessions, factory);
      return conn.hover(
        String(params.document ?? ''),
        toPosition(params.position),
        typeof params.uri === 'string' ? params.uri : undefined,
        signal
      );
    }
    case 'definition': {
      const conn = await ensureStarted(params, sessions, factory);
      return conn.definition(
        String(params.document ?? ''),
        toPosition(params.position),
        typeof params.uri === 'string' ? params.uri : undefined,
        signal
      );
    }
    default:
      throw new LspSidecarRpcError(
        'NOT_IMPLEMENTED',
        `LSP 侧车方法未实现：${action}`
      );
  }
}

async function handleRequest(
  frame: Record<string, unknown>,
  output: NodeJS.WritableStream,
  sessions: LspSessions,
  factory: LspConnectionFactory,
  inflight: Map<string, AbortController>
): Promise<void> {
  const id = String(frame.id);
  const method = String(frame.method ?? '');
  const params = toRecord(frame.params);
  const action = method.startsWith('lsp.') ? method.slice(4) : method;
  const controller = new AbortController();
  inflight.set(id, controller);
  try {
    const result = await dispatch(
      action,
      params,
      sessions,
      factory,
      controller.signal
    );
    output.write(encodeFrame({ id, success: true, result }));
  } catch (err) {
    const code = controller.signal.aborted
      ? 'CANCELLED'
      : err instanceof LspSidecarRpcError
        ? err.code
        : 'LSP_ERROR';
    const message = err instanceof Error ? err.message : String(err);
    output.write(
      encodeFrame({
        id,
        success: false,
        error: { code, message: `[${code}] ${message}` },
      })
    );
  } finally {
    inflight.delete(id);
  }
}

// 独立/子进程启动（`bun run src/tools/sidecar/lspSidecar.ts`）
if (import.meta.main) {
  // 父进程被硬杀 ⇒ 自清（防孤儿侧车占端口，基础设施专项 §6-#5）
  installParentLivenessGuard({
    onDetach: (parentPid) =>
      logger.warn('父进程已退出 ⇒ 侧车自清', { parentPid }),
  });
  startLspSidecar();
  logger.info('LSP 工具侧车已就绪（S2：真实 LS 接线）', { pid: process.pid });
}
