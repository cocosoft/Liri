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
 * LSP 侧车**自身**持有真实 language server 的**最小连接**（S2/T2.2）。
 *
 * 边界（如实）：
 * - 仅实现**本期覆盖**的 LSP 方法（`initialize` + `textDocument/hover` + `textDocument/definition`）；
 * - 传输为 LSP 标准 `Content-Length: N\r\n\r\n<body>` 分帧（stdio），**不**与仓内 sidecar IPC 契约混用
 *   （后者是**主进程 ↔ 侧车**的帧，本节是**侧车 ↔ LS**的帧，二者正交）；
 * - **不引用** `tools/lsp/**`、`app/src/lsp/**`（用户 2026-10-13 裁定 A：不触碰两轨）——
 *   语言→命令映射在此**最小复刻**（与 `tools/lsp/LSPToolImpl.ts:274-337` 同口径，仅供 LS 拉起）。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { getLogger } from '@modules/monitoring';
import { killProcessTree } from '@modules/utils/killProcessTree';
import { parentPidEnv } from '@modules/utils/parentLiveness';

const logger = getLogger('tools:sidecar:lspConnection');

/** LSP 位置（与内置工具面 `tools/lsp/types` 同形状） */
export interface LspPosition {
  line: number;
  character: number;
}

/** LSP 位置区间结果（与内置 `Location` 同形状） */
export interface LspLocation {
  uri: string;
  range: { start: LspPosition; end: LspPosition };
}

/** LS 启动命令 */
export interface LanguageServerCommand {
  serverPath: string;
  serverArgs: string[];
}

/**
 * 语言 → LS 启动命令（最小集，覆盖工具面 `language` 枚举）。
 * 与 `tools/lsp/LSPToolImpl.ts` 的 `getServerConfig()` 同口径（该方法是 private ⇒ 无法复用）。
 */
export function resolveLanguageServerCommand(
  language: string
): LanguageServerCommand | null {
  switch (language.toLowerCase()) {
    case 'typescript':
    case 'javascript':
      return {
        serverPath: 'npx',
        serverArgs: ['typescript-language-server', '--stdio'],
      };
    case 'python':
    case 'python3':
      return { serverPath: 'python', serverArgs: ['-m', 'pylsp'] };
    case 'java':
      return { serverPath: 'jdtls', serverArgs: [] };
    case 'csharp':
      return { serverPath: 'omnisharp', serverArgs: ['--stdio'] };
    case 'cpp':
    case 'c':
    case 'c++':
      return { serverPath: 'clangd', serverArgs: ['--background-index'] };
    case 'go':
    case 'golang':
      return { serverPath: 'gopls', serverArgs: [] };
    case 'rust':
    case 'rs':
      return { serverPath: 'rust-analyzer', serverArgs: [] };
    default:
      return null;
  }
}

export interface LspConnectionOptions {
  language: string;
  serverPath: string;
  serverArgs?: string[];
  cwd?: string;
  requestTimeoutMs?: number;
  /** spawn 注入（测试用；缺省 `node:child_process.spawn`） */
  spawnFn?: (
    command: string,
    args: string[],
    options: Record<string, unknown>
  ) => ChildProcess;
  /**
   * U-16 同类面（2026-10-18）：进程树强杀注入（缺省 `killProcessTree`）。
   *
   * 语言服务器常再派生工作进程 ⇒ 只 `child.kill()` 会留下孤儿。
   */
  killTree?: (child: ChildProcess) => void;
}

/** 侧车持有的 LSP 连接**端口**（供 `lspSidecar` 依赖注入 / 单测替身） */
export interface LspConnectionPort {
  start(): Promise<void>;
  hover(
    document: string,
    position: LspPosition,
    uri?: string,
    signal?: AbortSignal
  ): Promise<string | null>;
  definition(
    document: string,
    position: LspPosition,
    uri?: string,
    signal?: AbortSignal
  ): Promise<LspLocation[]>;
  stop(): Promise<void>;
}

/** LSP 连接工厂（侧车可注入替身；缺省真人 {@link LspSidecarConnection}） */
export type LspConnectionFactory = (
  opts: LspConnectionOptions
) => LspConnectionPort;

const LSP_SIDECAR_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_DOCUMENT_URI = 'file:///lsp-snippet';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  /** 清理副作用（如移除 abort 监听）；结算时必调 */
  cleanup?: () => void;
}

/** 最小 LSP 连接：spawn 并持有 LS，按 `Content-Length` 分帧做 request/response。 */
export class LspSidecarConnection implements LspConnectionPort {
  private child: ChildProcess | null = null;
  private started = false;
  private seq = 0;
  private buffer = '';
  private readonly pending = new Map<number, PendingRequest>();
  private readonly opened = new Set<string>();
  private readonly opts: LspConnectionOptions;
  private readonly timeoutMs: number;

  constructor(opts: LspConnectionOptions) {
    this.opts = opts;
    this.timeoutMs = opts.requestTimeoutMs ?? LSP_SIDECAR_REQUEST_TIMEOUT_MS;
  }

  async start(): Promise<void> {
    if (this.started) return;
    const spawnFn = this.opts.spawnFn ?? spawn;
    const child = spawnFn(this.opts.serverPath, this.opts.serverArgs ?? [], {
      cwd: this.opts.cwd || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...parentPidEnv() },
    });
    this.child = child;
    this.started = true;
    child.stdout?.on('data', (chunk: Buffer) => this.onData(chunk));
    child.once('exit', () => this.onExit());
    logger.info('LSP 侧车连接启动', {
      language: this.opts.language,
      serverPath: this.opts.serverPath,
    });
    try {
      await this.request('initialize', {
        processId: process.pid,
        rootUri: null,
        capabilities: {},
      });
      this.notify('initialized', {});
    } catch (err) {
      await this.stop();
      throw err;
    }
  }

  async hover(
    document: string,
    position: LspPosition,
    uri?: string,
    signal?: AbortSignal
  ): Promise<string | null> {
    const docUri = uri || DEFAULT_DOCUMENT_URI;
    this.openDocument(docUri, document);
    const result = await this.request(
      'textDocument/hover',
      {
        textDocument: { uri: docUri },
        position,
      },
      signal
    );
    const contents = (result as { contents?: unknown } | null)?.contents;
    return typeof contents === 'string' ? contents : null;
  }

  async definition(
    document: string,
    position: LspPosition,
    uri?: string,
    signal?: AbortSignal
  ): Promise<LspLocation[]> {
    const docUri = uri || DEFAULT_DOCUMENT_URI;
    this.openDocument(docUri, document);
    const result = await this.request(
      'textDocument/definition',
      {
        textDocument: { uri: docUri },
        position,
      },
      signal
    );
    return normalizeLocations(result);
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.started = false;
    this.rejectAllPending(new Error('LSP 侧车连接已关闭'));
    if (!child) return;
    try {
      // U-16 同类面：语言服务器的派生进程也要一并回收（缺省 `killProcessTree`）
      (this.opts.killTree ?? killProcessTree)(child);
    } catch {
      // @ignore-catch — 进程树强杀是尽力而为，失败不得打断关停流程
    }
  }

  private notify(method: string, params: unknown): void {
    this.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
  }

  /** LSP `$/cancelRequest` 通知（取消下传的最后一跳：侧车 ⇒ LS） */
  private cancelRequest(id: number): void {
    this.notify('$/cancelRequest', { id });
  }

  private request(
    method: string,
    params: unknown,
    signal?: AbortSignal
  ): Promise<unknown> {
    const id = ++this.seq;
    return new Promise<unknown>((resolve, reject) => {
      if (!this.child?.stdin?.writable) {
        reject(new Error('LSP 服务未就绪'));
        return;
      }
      const timer = setTimeout(
        () =>
          this.settle(id, (p) =>
            p.reject(new Error(`LSP 请求超时：${method}`))
          ),
        this.timeoutMs
      );
      const onAbort = (): void => {
        this.cancelRequest(id); // 转发为 LSP $/cancelRequest（若已建立连接）
        this.settle(id, (p) =>
          p.reject(new Error(`LSP 请求已取消：${method}`))
        );
      };
      if (signal?.aborted) {
        clearTimeout(timer);
        reject(new Error(`LSP 请求已取消：${method}`));
        return;
      }
      const cleanup = signal
        ? () => signal.removeEventListener('abort', onAbort)
        : undefined;
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, { resolve, reject, timer, cleanup });
      this.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  /** 统一结算：移除 pending + 清计时器 + 清副作用，再执行 resolve/reject */
  private settle(id: number, action: (p: PendingRequest) => void): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.cleanup?.();
    action(pending);
  }

  private send(message: string): void {
    const stdin = this.child?.stdin;
    if (!stdin?.writable) return;
    stdin.write(
      `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`
    );
  }

  /** 首次查询前把文档 `didOpen` 给 LS（真实 LS 需要文档内容才能作答） */
  private openDocument(uri: string, text: string): void {
    if (!text || this.opened.has(uri)) return;
    this.opened.add(uri);
    this.notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: this.opts.language,
        version: 1,
        text,
      },
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const matched = this.buffer
        .slice(0, headerEnd)
        .match(/Content-Length: (\d+)/);
      if (!matched) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number(matched[1]);
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return; // 帧未收全
      const body = this.buffer.slice(start, start + length);
      this.buffer = this.buffer.slice(start + length);
      this.handleMessage(body);
    }
  }

  private handleMessage(body: string): void {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(body) as Record<string, unknown>;
    } catch {
      return; // 非法帧 ⇒ 忽略
    }
    const id = data.id;
    if (typeof id !== 'number') return; // 通知（无 id）⇒ 忽略（如 publishDiagnostics）
    if (!this.pending.has(id)) return;
    if (data.error) {
      const err = data.error as { message?: string };
      this.settle(id, (p) =>
        p.reject(new Error(err.message || 'LSP 请求失败'))
      );
      return;
    }
    this.settle(id, (p) => p.resolve(data.result));
  }

  private onExit(): void {
    this.child = null;
    this.started = false;
    this.rejectAllPending(new Error('LSP 服务已退出'));
  }

  private rejectAllPending(reason: Error): void {
    for (const id of [...this.pending.keys()]) {
      this.settle(id, (p) => p.reject(reason));
    }
  }
}

/** 归一化 `textDocument/definition` 结果为 `LspLocation[]`（单值 ⇒ 单元素数组） */
function normalizeLocations(result: unknown): LspLocation[] {
  if (Array.isArray(result)) return result as LspLocation[];
  return result ? [result as LspLocation] : [];
}
