/**
 * JsonRpcBridge — TypeScript ↔ 子进程 的通用 StdIO JSON-RPC 桥接层（PY-1 泛化基类）
 *
 * 协议：每行一个 JSON 消息（换行分隔，无粘包）
 * 生命周期：spawn → startup（超时可配）→ 请求/响应循环 + notify 通知帧 → destroy
 *
 * 与 StdioBridge（视觉）的关系：StdioBridge 复用本基类通用逻辑，视觉链路行为不变；
 * Python 插件桥（PythonPluginAdapter）也基于本基类，通过 options 配置差异。
 *
 * 相对原 StdioBridge 的增强（PY-1）：
 * - startup 超时参数化（原 3s 写死，Python 插件大依赖场景需 10-15s）
 * - pythonPath / workerScript 必传（venv 解释器绑定）
 * - 双 settle 修复：startup 超时 reject 后 destroy 触发 exit，不再二次 reject
 * - notify 无 id 通知帧：子进程 → 主进程（onNotify 回调）+ 主进程 → 子进程（sendNotify）
 * - 受限 env 支持（buildSafeEnv 基线，3.6 环境治理）
 * - 错误格式双兼容：{ code, message }（视觉现状）与 AppError 四字段均透传
 */
import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('ai:python:jsonRpcBridge');

/** 请求默认超时 (ms) */
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
/** 默认启动超时 (ms) */
const DEFAULT_STARTUP_TIMEOUT_MS = 10000;

/** 桥接协议版本（PY-1 版本协商：initialize 响应带此版本，主进程校验 major 兼容） */
export const BRIDGE_PROTOCOL_VERSION = 1;

/** JSON-RPC 请求 */
interface JsonRpcRequest {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 响应（错误兼容 {code,message} 与 AppError 四字段） */
export interface JsonRpcResponse<T = unknown> {
  id: string;
  success: boolean;
  result?: T;
  error?: { code: string; message: string };
  category?: string;
  severity?: string;
  errorCode?: string;
}

/** 待处理的请求映射 */
interface PendingRequest {
  resolve: (value: JsonRpcResponse) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** 桥接配置 */
export interface JsonRpcBridgeOptions {
  /** Python 解释器路径（venv 内解释器，PY-0/3.2 必传） */
  pythonPath: string;
  /** worker 脚本路径 */
  workerScript: string;
  /** startup 握手超时 (ms)，默认 10s（Python 插件大依赖场景按需放大） */
  startupTimeoutMs?: number;
  /** 请求默认超时 (ms)，默认 30s */
  requestTimeoutMs?: number;
  /** 受限 env（3.6 buildSafeEnv 基线；缺省继承 process.env） */
  env?: NodeJS.ProcessEnv;
  /** spawn 附加参数 */
  args?: string[];
  /** 子进程主动推送帧回调（无 id 通知，type==='notify'） */
  onNotify?: (frame: {
    event?: string;
    data?: unknown;
    [key: string]: unknown;
  }) => void;
  /**
   * 子进程发来的请求回调（fromChild 请求，PY-3 服务代理反向 RPC 用）
   * 返回 Promise 结果将作为响应写回子进程；抛错则回错误帧。
   */
  onChildRequest?: (
    method: string,
    params: Record<string, unknown>
  ) => Promise<unknown>;
}

/**
 * JsonRpcBridge
 * 管理一个子进程，支持并发请求 + 主进程→子进程/子进程→主进程双向 notify。
 */
export class JsonRpcBridge {
  protected process: ChildProcess | null = null;
  private requestId = 0;
  private pending = new Map<string, PendingRequest>();
  private started = false;
  private dying = false;
  private readonly options: Required<
    Pick<
      JsonRpcBridgeOptions,
      'pythonPath' | 'workerScript' | 'startupTimeoutMs' | 'requestTimeoutMs'
    >
  > &
    JsonRpcBridgeOptions;

  constructor(options: JsonRpcBridgeOptions) {
    this.options = {
      startupTimeoutMs: DEFAULT_STARTUP_TIMEOUT_MS,
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      ...options,
    };
  }

  /** 启动子进程（startup 握手，settled 防双 settle） */
  async start(): Promise<void> {
    if (this.started) return;
    if (this.dying) throw new Error('JsonRpcBridge is shutting down');

    let settled = false;

    return new Promise<void>((resolve, reject) => {
      const fail = (err: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(startupTimer);
        reject(err);
      };
      const succeed = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(startupTimer);
        resolve();
      };

      const startupTimer = setTimeout(() => {
        fail(new Error('Worker startup timed out'));
        this.destroy();
      }, this.options.startupTimeoutMs);

      this.process = spawn(
        this.options.pythonPath,
        [this.options.workerScript, ...(this.options.args ?? [])],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: this.options.env,
        }
      );

      const rl = createInterface({ input: this.process.stdout! });

      rl.on('line', (line: string) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(line);
        } catch {
          // 非 JSON 行（如 Python 打印的调试输出），忽略（stdout 仅限协议帧约束）
          return;
        }

        // 启动信号（子进程主动发，进程级就绪）
        if (msg.type === 'startup') {
          this.started = true;
          logger.info('JsonRpcBridge · worker 已启动', {
            pid: msg.pid,
          });
          succeed();
          return;
        }

        // 请求响应（带 id，主进程发起的请求的响应）
        if (typeof msg.id === 'string') {
          const pending = this.pending.get(msg.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(msg.id);
            pending.resolve(msg as unknown as JsonRpcResponse);
            return;
          }
          // 子进程 → 主进程 请求（服务代理反向 RPC，fromChild）
          if (msg.fromChild === true && this.options.onChildRequest) {
            void this.handleChildRequest(
              msg.id as string,
              String(msg.method ?? ''),
              (msg.params ?? {}) as Record<string, unknown>
            );
            return;
          }
        }

        // notify 无 id 通知帧（子进程 → 主进程单向推送）
        if (msg.type === 'notify' && this.options.onNotify) {
          this.options.onNotify(msg);
          return;
        }
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        logger.warn('JsonRpcBridge · worker stderr', {
          message: data.toString().trim(),
        });
      });

      this.process.on('exit', (code, signal) => {
        logger.warn('JsonRpcBridge · worker 退出', { code, signal });
        this.started = false;
        // 拒绝所有待处理请求
        for (const [id, pending] of this.pending) {
          clearTimeout(pending.timer);
          pending.reject(new Error(`Worker exited (code=${code})`));
          this.pending.delete(id);
        }
      });

      this.process.on('error', (err) => {
        fail(err);
      });
    });
  }

  /**
   * 发送请求并等待完整响应
   * @param method 方法名
   * @param params 参数
   * @param timeoutMs 超时 (ms)，默认取构造配置
   */
  async request<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<JsonRpcResponse<T>> {
    if (!this.started || !this.process) {
      throw new Error('JsonRpcBridge: worker not started');
    }

    const id = `req_${++this.requestId}_${Date.now()}`;
    const req: JsonRpcRequest = { id, method, params };
    const effectiveTimeout = timeoutMs ?? this.options.requestTimeoutMs;

    return new Promise<JsonRpcResponse<T>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(`Request timed out: ${method} (${effectiveTimeout}ms)`)
        );
      }, effectiveTimeout);

      this.pending.set(id, {
        resolve: resolve as (v: JsonRpcResponse) => void,
        reject,
        timer,
      });

      const line = JSON.stringify(req) + '\n';
      this.process!.stdin!.write(line);
    });
  }

  /**
   * 发送请求并解包 result（success=false 时抛出错误）
   * Python 插件桥推荐使用；视觉链路如需原始响应仍用 request()。
   */
  async requestResult<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<T> {
    const res = await this.request<T>(method, params, timeoutMs);
    if (!res.success) {
      throw new Error(
        `RPC ${method} failed: ${res.error?.message ?? res.errorCode ?? 'unknown'}`
      );
    }
    return res.result as T;
  }

  /**
   * 处理子进程发来的请求（fromChild）并写回响应
   */
  private async handleChildRequest(
    id: string,
    method: string,
    params: Record<string, unknown>
  ): Promise<void> {
    if (!this.options.onChildRequest || !this.process) return;
    try {
      const result = await this.options.onChildRequest(method, params);
      const line = JSON.stringify({ id, success: true, result }) + '\n';
      this.process!.stdin!.write(line);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const line =
        JSON.stringify({
          id,
          success: false,
          error: { code: 'INTERNAL_ERROR', message },
          errorCode: 'INTERNAL_ERROR',
        }) + '\n';
      this.process!.stdin!.write(line);
    }
  }

  /**
   * 主进程 → 子进程 单向 notify 通知帧（无 id）
   * 用于系统事件 → Python 插件方向（subscribeEvent 的另一半）
   */
  sendNotify(payload: Record<string, unknown>): void {
    if (!this.started || !this.process) {
      throw new Error('JsonRpcBridge: worker not started');
    }
    const line = JSON.stringify({ type: 'notify', ...payload }) + '\n';
    this.process.stdin!.write(line);
  }

  /** 检查 worker 是否就绪 */
  isReady(): boolean {
    return this.started && this.process !== null && !this.process.killed;
  }

  /** 获取底层子进程（供 ChildProcessTracker 注册追踪，PY-5） */
  getProcess(): ChildProcess | null {
    return this.process;
  }

  /** 销毁 worker 进程（写 __SHUTDOWN__ 裸行 + 1s 后强杀，兼容 vision_worker） */
  destroy(): void {
    this.dying = true;
    if (this.process) {
      try {
        this.process.stdin?.write('__SHUTDOWN__\n');
      } catch {
        // stdin 可能已关闭
      }
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill();
        }
      }, 1000);
    }
    this.started = false;
  }
}
