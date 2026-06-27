/**
 * StdioBridge
 * TypeScript ↔ Python 进程的 StdIO JSON-RPC 桥接层
 *
 * 协议：每行一个 JSON 消息（换行分隔，无粘包）
 * 生命周期：spawn → startup(3s超时) → 请求/响应循环 → destroy
 */

import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { createInterface } from 'readline';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO, module: 'ai:python:bridge' });

/** 启动超时 (ms) */
const STARTUP_TIMEOUT_MS = 3000;
/** 请求默认超时 (ms) */
const REQUEST_TIMEOUT_MS = 30000;

/** JSON-RPC 请求 */
interface JsonRpcRequest {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 响应 */
interface JsonRpcResponse<T = unknown> {
  id: string;
  success: boolean;
  result?: T;
  error?: { code: string; message: string };
}

/** 待处理的请求映射 */
interface PendingRequest {
  resolve: (value: JsonRpcResponse) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * StdioBridge
 * 管理一个 Python vision_worker 子进程，支持并发请求（FIFO 序列化）
 */
export class StdioBridge {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pending = new Map<string, PendingRequest>();
  private started = false;
  private dying = false;
  private pythonPath: string;
  private workerScript: string;

  constructor(pythonPath = 'python', workerScript?: string) {
    this.pythonPath = pythonPath;
    // 脚本路径解析（兼容开发与编译两种模式）
    if (workerScript) {
      this.workerScript = workerScript;
    } else {
      const projectDir = process.env.PYAPP_PROJECT_DIR || process.cwd();
      this.workerScript = path.resolve(
        projectDir,
        'app',
        'src',
        'ai',
        'python',
        'vision_worker.py'
      );
    }
  }

  /** 启动 Python 子进程 */
  async start(): Promise<void> {
    if (this.started) return;
    if (this.dying) throw new Error('StdioBridge is shutting down');

    return new Promise((resolve, reject) => {
      const startupTimer = setTimeout(() => {
        reject(new Error('Python worker startup timed out'));
        this.destroy();
      }, STARTUP_TIMEOUT_MS);

      this.process = spawn(this.pythonPath, [this.workerScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const rl = createInterface({ input: this.process.stdout! });

      rl.on('line', (line: string) => {
        try {
          const msg = JSON.parse(line);
          // 启动信号
          if (msg.type === 'startup') {
            clearTimeout(startupTimer);
            this.started = true;
            logger.info('StdioBridge · Python worker 已启动', {
              pid: msg.pid,
              models: msg.models,
            });
            resolve();
            return;
          }
          // 请求响应
          if (msg.id && this.pending.has(msg.id)) {
            const pending = this.pending.get(msg.id)!;
            clearTimeout(pending.timer);
            this.pending.delete(msg.id);
            pending.resolve(msg as JsonRpcResponse);
          }
        } catch {
          // 非 JSON 行（如 Python 打印的调试输出），忽略
        }
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        logger.warn('StdioBridge · Python stderr', {
          message: data.toString().trim(),
        });
      });

      this.process.on('exit', (code, signal) => {
        logger.warn('StdioBridge · Python worker 退出', { code, signal });
        this.started = false;
        // 拒绝所有待处理请求
        for (const [id, pending] of this.pending) {
          clearTimeout(pending.timer);
          pending.reject(new Error(`Python worker exited (code=${code})`));
          this.pending.delete(id);
        }
      });

      this.process.on('error', (err) => {
        clearTimeout(startupTimer);
        reject(err);
      });
    });
  }

  /**
   * 发送请求并等待响应
   * @param method 方法名
   * @param params 参数
   * @param timeoutMs 超时 (ms)，默认 30s
   */
  async request<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = REQUEST_TIMEOUT_MS
  ): Promise<T> {
    if (!this.started || !this.process) {
      throw new Error('StdioBridge: worker not started');
    }

    const id = `req_${++this.requestId}_${Date.now()}`;
    const req: JsonRpcRequest = { id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timed out: ${method} (${timeoutMs}ms)`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (v: JsonRpcResponse) => void,
        reject,
        timer,
      });

      const line = JSON.stringify(req) + '\n';
      this.process!.stdin!.write(line);
    });
  }

  /** 检查 worker 是否就绪 */
  isReady(): boolean {
    return this.started && this.process !== null && !this.process.killed;
  }

  /** 销毁 worker 进程 */
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

/**
 * 确保 Python 可用
 * 在首次使用前调用以检测 python 命令是否在 PATH 中
 */
export async function checkPythonAvailable(
  pythonPath = 'python'
): Promise<boolean> {
  try {
    const proc = spawn(pythonPath, ['--version'], { stdio: 'pipe' });
    return new Promise((resolve) => {
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  } catch {
    return false;
  }
}
