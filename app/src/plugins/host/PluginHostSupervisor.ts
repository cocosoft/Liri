/**
 * 第三方插件的**子进程宿主监督器**（T25-08 P1）。
 *
 * 方案：`.trae/specs/plugin-process-isolation.md` §4「P1」+ §6 验收口径。
 *
 * 职责：
 * - 以**白名单 env** 拉起 `pluginHostEntry.ts`（宿主 `.env` 不继承 ⇒ 插件读不到密钥）；
 * - P1 契约握手（`startup` 帧，含 `protocolVersion` / `pid`）+ `request/response` 分帧；
 * - 插件**工具声明**（`notify{tools.register}`）⇒ 在宿主注册**代理工具**，执行走 RPC，
 *   并在宿主侧留审计（`onToolAudit`，缺省落 app.log）；
 * - 崩溃 ⇒ 在飞请求全拒（主进程不崩）+ **有界重启**（`maxRestarts`，超限 fail-closed）。
 *
 * 非目标（如实）：文件系统 / 网络隔离不在本切片（那属于沙箱职责）。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { getLogger } from '@modules/monitoring';
import { killProcessTree } from '@modules/utils/killProcessTree';
import {
  SIDECAR_IPC_PROTOCOL_VERSION,
  SIDECAR_STARTUP_TYPE,
  buildRequestFrame,
  decodeFrame,
  encodeFrame,
  isCompatibleVersion,
  isHeartbeatFrame,
} from '@modules/utils/sidecarIpc';
import type { Tool } from '@modules/tools/types/Tool';
import { getToolRegistry } from '../../tools/ToolRegistry';
import { buildRegisteredTool } from '../utils/toolRegistration';
import type { PluginToolDeclaration } from '../utils/toolRegistration';
import {
  PLUGIN_HOST_METHOD,
  buildPluginHostEnv,
  parsePluginLog,
  parseStartFailed,
  parseToolDeclarations,
} from './pluginHostProtocol';

const logger = getLogger('plugins:host:supervisor');

/** 插件目标（由 `PluginLoader` 提供） */
export interface PluginHostTarget {
  pluginId: string;
  /** 插件根目录（`plugin.json` 所在目录） */
  pluginDir: string;
  /** 入口文件绝对路径 */
  entryPath: string;
}

/** 宿主侧工具登记表端口（默认走全局单例 `ToolRegistry`；测试注入替身） */
export interface PluginHostToolRegistryPort {
  registerTool(
    tool: Tool,
    options?: { onConflict?: 'error' | 'overwrite' }
  ): void;
  unregisterTool(name: string): void;
}

/** 一次工具调用的审计记录（宿主侧） */
export interface PluginToolAuditRecord {
  pluginId: string;
  toolName: string;
  ok: boolean;
  durationMs: number;
  at: number;
  error?: string;
}

export interface PluginHostSupervisorDeps {
  /** spawn 注入（测试用；缺省 `node:child_process.spawn`） */
  spawnFn?: (
    command: string,
    args: string[],
    options: Record<string, unknown>
  ) => ChildProcess;
  /** 子进程入口脚本（缺省本模块同级 `pluginHostEntry.ts`） */
  scriptPath?: string;
  /** 运行时（缺省 `process.execPath`） */
  runtimePath?: string;
  /** 就绪握手超时（默认 15s：插件要完成 `import` + 生命周期） */
  startupTimeoutMs?: number;
  /** 有界重启上限（默认 3） */
  maxRestarts?: number;
  /** 单个请求超时（默认 30s） */
  requestTimeoutMs?: number;
  /** 优雅关停预算（默认 3s；超时 ⇒ 退回强制停止） */
  shutdownTimeoutMs?: number;
  /** 进程树强杀注入（缺省 `killProcessTree`） */
  killTree?: (child: ChildProcess) => void;
  /** 工具登记表端口（缺省全局单例） */
  registry?: PluginHostToolRegistryPort;
  /** 子进程 env 的**基座**（缺省 `process.env`；测试注入以验证白名单） */
  baseEnv?: NodeJS.ProcessEnv;
  /** 工具调用审计出口（缺省落 app.log） */
  onToolAudit?: (record: PluginToolAuditRecord) => void;
}

interface PendingRequest {
  resolve: (frame: Record<string, unknown>) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ReadyWaiter {
  resolve: () => void;
  reject: (reason: Error) => void;
}

export class PluginHostSupervisor {
  private child: ChildProcess | null = null;
  private stopping = false;
  private ready = false;
  private restarts = 0;
  private seq = 0;
  /** 有界重启超限后的持久降级态（后续请求 fail-closed） */
  private fatal: Error | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly readyWaiters: ReadyWaiter[] = [];
  /** 本插件已注册到宿主工具表的名字（退出/停止时逐一注销） */
  private readonly registeredTools = new Set<string>();
  private registryPort: PluginHostToolRegistryPort | null = null;

  constructor(
    private readonly target: PluginHostTarget,
    private readonly deps: PluginHostSupervisorDeps = {}
  ) {}

  isRunning(): boolean {
    return this.child !== null && this.ready;
  }

  getRestarts(): number {
    return this.restarts;
  }

  /** 已注册的代理工具名（观测/测试用） */
  getRegisteredToolNames(): string[] {
    return [...this.registeredTools];
  }

  /** 拉起子进程并等待**就绪握手**；失败/超时/版本不兼容 ⇒ 抛错（调用方 fail-closed） */
  async start(): Promise<{ pid?: number }> {
    if (this.child) return { pid: this.child.pid };
    this.stopping = false;
    const runtime = this.deps.runtimePath ?? process.execPath;
    const script =
      this.deps.scriptPath ??
      fileURLToPath(new URL('./pluginHostEntry.ts', import.meta.url));
    const spawnFn = this.deps.spawnFn ?? spawn;
    const child = spawnFn(runtime, [script], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildPluginHostEnv(this.deps.baseEnv ?? process.env, {
        pluginId: this.target.pluginId,
        pluginDir: this.target.pluginDir,
        entryPath: this.target.entryPath,
      }),
    });
    this.child = child;

    const abortStart = (): void => {
      this.child = null;
      this.ready = false;
      this.killChildTree(child);
    };

    const timeoutMs = this.deps.startupTimeoutMs ?? 15_000;
    const pid = await new Promise<number | undefined>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        abortStart();
        reject(new Error(`插件子进程就绪超时（${this.target.pluginId}）`));
      }, timeoutMs);
      const rl = readline.createInterface({ input: child.stdout! });
      rl.on('line', (line) => {
        const frame = decodeFrame(line);
        if (!frame) return;
        if (frame.type === SIDECAR_STARTUP_TYPE) {
          if (settled) return;
          if (!isCompatibleVersion(frame.protocolVersion)) {
            settled = true;
            clearTimeout(timer);
            abortStart();
            reject(
              new Error(
                `插件宿主协议版本不兼容：${String(frame.protocolVersion)} vs ${SIDECAR_IPC_PROTOCOL_VERSION}`
              )
            );
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve(typeof frame.pid === 'number' ? frame.pid : child.pid);
          return;
        }
        const failed = parseStartFailed(frame);
        if (failed !== null && !settled) {
          settled = true;
          clearTimeout(timer);
          abortStart();
          reject(
            new Error(`插件启动失败（${this.target.pluginId}）：${failed}`)
          );
          return;
        }
        this.handleFrame(frame);
      });
      child.once('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        abortStart();
        reject(err);
      });
    });

    this.ready = true;
    this.fatal = null;
    child.on('exit', (code) => this.onExit(code));
    this.flushReady();
    logger.info('插件子进程宿主已就绪', {
      pluginId: this.target.pluginId,
      pid,
    });
    return { pid };
  }

  /** 发起一次请求（写 `request` 帧），等待匹配 id 的 `response` 帧 */
  async request(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<Record<string, unknown>> {
    if (!this.isRunning()) {
      await this.waitUntilReady(this.deps.startupTimeoutMs ?? 15_000);
    }
    const stdin = this.child?.stdin;
    if (!stdin?.writable) {
      throw new Error(`插件宿主未就绪（${this.target.pluginId}）`);
    }
    const id = `pluginhost_${++this.seq}`;
    const timeoutMs = this.deps.requestTimeoutMs ?? 30_000;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.settle(id, (p) =>
            p.reject(new Error(`插件宿主请求超时：${method}`))
          ),
        timeoutMs
      );
      this.pending.set(id, { resolve, reject, timer });
      stdin.write(encodeFrame(buildRequestFrame(id, method, params)));
    });
  }

  /**
   * **优雅关停**：先请求子进程执行 `destroy`/`unload`（有超时），再强制停止。
   *
   * 为什么要这一步：`stop()` 直接走进程树强杀，插件的 `destroy` 永远没机会跑
   * （落盘 / 释放句柄 / 停定时器）。超时或失败 ⇒ 退回 `stop()`（**尽力而为，不悬挂**）。
   *
   * ⚠️ 先置 `stopping = true`：子进程收到 `plugin.shutdown` 后会自退，若不先置位，
   * 退出回调会把它当成**崩溃**去有界重启（卸载即复活）。
   */
  async shutdown(timeoutMs?: number): Promise<void> {
    this.stopping = true;
    if (this.isRunning()) {
      const budget = timeoutMs ?? this.deps.shutdownTimeoutMs ?? 3_000;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.request(PLUGIN_HOST_METHOD.SHUTDOWN, {}),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error('插件宿主优雅关停超时')),
              budget
            );
          }),
        ]);
      } catch (error) {
        logger.warn('插件宿主优雅关停失败 ⇒ 强制停止', {
          pluginId: this.target.pluginId,
          error: String(error),
        });
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    this.stop();
  }

  /** 停止子进程（注销代理工具；不再重启） */
  stop(): void {
    this.stopping = true;
    this.ready = false;
    const child = this.child;
    this.child = null;
    this.unregisterTools();
    this.rejectAllPending(
      new Error(`插件宿主已停止（${this.target.pluginId}）`)
    );
    this.settleReady(new Error(`插件宿主已停止（${this.target.pluginId}）`));
    if (!child) return;
    this.killChildTree(child);
  }

  /** 工具登记表端口（缺省全局单例；懒取 ⇒ import 期不碰内核） */
  private registry(): PluginHostToolRegistryPort {
    this.registryPort ??= this.deps.registry ?? getToolRegistry();
    return this.registryPort;
  }

  /**
   * 把**声明**装配成宿主侧代理工具。
   *
   * 撞名（与内置工具或其它插件）⇒ 记 warn 并跳过该工具，**不覆盖**（避免静默劫持）。
   */
  private registerDeclaredTools(declarations: PluginToolDeclaration[]): void {
    const port = this.registry();
    for (const decl of declarations) {
      if (this.registeredTools.has(decl.name)) continue;
      const tool = buildRegisteredTool(decl, async (input) => {
        const started = Date.now();
        try {
          const response = await this.request(PLUGIN_HOST_METHOD.TOOL_EXECUTE, {
            name: decl.name,
            input,
          });
          this.audit({
            pluginId: this.target.pluginId,
            toolName: decl.name,
            ok: true,
            durationMs: Date.now() - started,
            at: started,
          });
          return response.result ?? null;
        } catch (error) {
          this.audit({
            pluginId: this.target.pluginId,
            toolName: decl.name,
            ok: false,
            durationMs: Date.now() - started,
            at: started,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      });
      try {
        port.registerTool(tool, { onConflict: 'error' });
        this.registeredTools.add(decl.name);
      } catch (error) {
        logger.warn('插件工具注册被拒（撞名）', {
          pluginId: this.target.pluginId,
          toolName: decl.name,
          error: String(error),
        });
      }
    }
  }

  /** 注销本插件注册的全部代理工具（幂等） */
  private unregisterTools(): void {
    if (this.registeredTools.size === 0) return;
    const port = this.registry();
    for (const name of [...this.registeredTools]) {
      try {
        port.unregisterTool(name);
      } catch (error) {
        logger.warn('插件工具注销失败', {
          toolName: name,
          error: String(error),
        });
      }
    }
    this.registeredTools.clear();
  }

  private audit(record: PluginToolAuditRecord): void {
    if (this.deps.onToolAudit) {
      this.deps.onToolAudit(record);
      return;
    }
    logger.info('plugins:host:tool-audit', record);
  }

  private killChildTree(child: ChildProcess): void {
    try {
      (this.deps.killTree ?? killProcessTree)(child);
    } catch {
      // @ignore-catch — 进程树强杀是尽力而为，失败不得打断关停/失败路径
    }
  }

  private waitUntilReady(timeoutMs: number): Promise<void> {
    if (this.isRunning()) return Promise.resolve();
    if (this.fatal) return Promise.reject(this.fatal);
    return new Promise<void>((resolve, reject) => {
      const waiter: ReadyWaiter = { resolve: () => {}, reject: () => {} };
      const timer = setTimeout(() => {
        const i = this.readyWaiters.indexOf(waiter);
        if (i >= 0) this.readyWaiters.splice(i, 1);
        reject(new Error(`插件宿主就绪超时（${this.target.pluginId}）`));
      }, timeoutMs);
      waiter.resolve = () => {
        clearTimeout(timer);
        resolve();
      };
      waiter.reject = (reason) => {
        clearTimeout(timer);
        reject(reason);
      };
      this.readyWaiters.push(waiter);
      if (this.isRunning()) waiter.resolve();
    });
  }

  private flushReady(): void {
    for (const w of this.readyWaiters.splice(0)) w.resolve();
  }

  private settleReady(reason: Error): void {
    for (const w of this.readyWaiters.splice(0)) w.reject(reason);
  }

  /** 子进程帧分派（就绪后由同一 readline 监听器调用） */
  private handleFrame(frame: Record<string, unknown>): void {
    if (isHeartbeatFrame(frame)) return;

    const declarations = parseToolDeclarations(frame);
    if (declarations) {
      this.registerDeclaredTools(declarations);
      return;
    }

    const pluginLog = parsePluginLog(frame);
    if (pluginLog) {
      logger.info('plugins:host:plugin-log', {
        pluginId: this.target.pluginId,
        level: pluginLog.level,
        message: pluginLog.message,
      });
      return;
    }

    const id = frame.id;
    if (typeof id !== 'string') return;
    if (!this.pending.has(id)) return;
    if (frame.success === false) {
      const err = (frame.error ?? {}) as Record<string, unknown>;
      this.settle(id, (p) =>
        p.reject(new Error(String(err.message ?? '插件宿主请求失败')))
      );
      return;
    }
    this.settle(id, (p) => p.resolve(frame));
  }

  private settle(id: string, action: (p: PendingRequest) => void): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    action(pending);
  }

  private rejectAllPending(reason: Error): void {
    for (const id of [...this.pending.keys()]) {
      this.settle(id, (p) => p.reject(reason));
    }
  }

  private onExit(code: number | null): void {
    this.ready = false;
    this.child = null;
    // 崩溃 ⇒ 代理工具必须立刻下线（否则模型会调到"必然失败"的工具）
    this.unregisterTools();
    this.rejectAllPending(
      new Error(
        `插件子进程已退出（${this.target.pluginId}, code=${String(code)}）`
      )
    );
    if (this.stopping) return;
    const maxRestarts = this.deps.maxRestarts ?? 3;
    if (this.restarts >= maxRestarts) {
      this.fatal = new Error(
        `插件宿主不可用（${this.target.pluginId}，重启超限，fail-closed）`
      );
      this.settleReady(this.fatal);
      logger.warn('插件子进程反复退出 ⇒ 停止重启（fail-closed）', {
        pluginId: this.target.pluginId,
        code,
        restarts: this.restarts,
      });
      return;
    }
    this.restarts += 1;
    logger.warn('插件子进程意外退出 ⇒ 重启', {
      pluginId: this.target.pluginId,
      code,
      attempt: this.restarts,
    });
    // 崩溃的请求**不自动重试**（避免重复副作用）：仅重启进程
    void this.start().catch((err: unknown) => {
      logger.warn('插件子进程重启失败', {
        pluginId: this.target.pluginId,
        error: String(err),
      });
      this.settleReady(new Error(`插件子进程重启失败：${String(err)}`));
    });
  }
}
