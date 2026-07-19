/**
 * cli-manager.ts — 微信 CLI 生命周期管理器
 *
 * 负责自动检测、安装、启动 weixin-cli (@tencent-weixin/openclaw-weixin-cli)，
 * 捕获 stdout 中的登录二维码信息，供前端展示扫码。
 *
 * 使用方式:
 *   const mgr = WeixinCliManager.getInstance();
 *   await mgr.ensureReady();
 *   const status = mgr.getStatus();
 *   // status.qrCodeUrl / status.qrBase64 / status.state
 */

import { EventEmitter } from 'events';
import { spawn, type ChildProcess } from 'child_process';
import { createHash } from 'crypto';
import path from 'path';
import fs from 'fs';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'channels:wechat:cli-manager',
  level: LogLevel.INFO,
});

// ─── 日志工具（独立轻量，不依赖外部 logger） ─────────────

function log(level: string, msg: string, ...args: unknown[]): void {
  const ts = new Date().toISOString().slice(11, 23);
  const prefix = `[cli-manager][${level.toUpperCase()}][${ts}]`;
  if (level === 'error') {
    console.error(prefix, msg, ...args);
  } else {
    console.log(prefix, msg, ...args);
  }
}

// ─── 类型定义 ──────────────────────────────────────────

/** weixin-cli 状态枚举 */
export type CliState =
  | 'idle'
  | 'installing'
  | 'installed'
  | 'starting'
  | 'running'
  | 'waiting_scan'
  | 'logged_in'
  | 'error';

/** 对外暴露的状态快照 */
export interface CliStatus {
  state: CliState;
  installed: boolean;
  running: boolean;
  /** 登录二维码 (Base64 图片) */
  qrBase64: string | null;
  /** 二维码原始文本（可能是 URL） */
  qrRaw: string | null;
  /** 最后错误信息 */
  lastError: string | null;
  /** 进程 PID（运行时） */
  pid: number | null;
  /** 已运行秒数（运行时） */
  uptimeSec: number | null;
}

// ─── 常量 ──────────────────────────────────────────────

const CLI_PACKAGE = '@tencent-weixin/openclaw-weixin-cli';
const POLL_INTERVAL_QR_MS = 1_500;
const QR_LINE_REGEX =
  /(https:\/\/open\.weixin\.qq\.com\/connect\/qrcode[^\s]*)/i;
const QR_RAW_REGEX = /qrlogin|qrcode|扫码/i;

// ─── 管理器实现 ────────────────────────────────────────

export class WeixinCliManager extends EventEmitter {
  private static instance: WeixinCliManager;

  /** 当前状态 */
  private _state: CliState = 'idle';
  /** 子进程引用 */
  private _process: ChildProcess | null = null;
  /** 进程启动时间 */
  private _startedAt: number = 0;
  /** 捕获到的二维码 Base64 */
  private _qrBase64: string | null = null;
  /** 捕获到的二维码原始 URL */
  private _qrRaw: string | null = null;
  /** 最后错误消息 */
  private _lastError: string | null = null;
  /** stdout 缓冲区（用于提取二维码） */
  private _stdoutBuf = '';
  /** 安装状态 */
  private _installed = false;
  /** 安装完成 promise */
  private _installPromise: Promise<boolean> | null = null;

  private constructor() {
    super();
  }

  /** 获取单例 */
  static getInstance(): WeixinCliManager {
    if (!WeixinCliManager.instance) {
      WeixinCliManager.instance = new WeixinCliManager();
    }
    return WeixinCliManager.instance;
  }

  // ─── 公共查询方法 ─────────────────────────────────────

  get state(): CliState {
    return this._state;
  }

  get installed(): boolean {
    return this._installed;
  }

  get running(): boolean {
    return this._process !== null && this._process.exitCode === null;
  }

  /** 获取状态快照 */
  getStatus(): CliStatus {
    return {
      state: this._state,
      installed: this._installed,
      running: this.running,
      qrBase64: this._qrBase64,
      qrRaw: this._qrRaw,
      lastError: this._lastError,
      pid: this._process?.pid ?? null,
      uptimeSec: this.running
        ? Math.floor((Date.now() - this._startedAt) / 1000)
        : null,
    };
  }

  // ─── 确保就绪（安装 + 启动） ───────────────────────────

  /**
   * 确保 weixin-cli 已安装并启动
   * @returns true 表示启动成功（含等待扫码），false 表示失败
   */
  async ensureReady(): Promise<boolean> {
    // 已运行
    if (this.running) return true;

    // 安装（如未安装）
    const installed = await this.ensureInstalled();
    if (!installed) return false;

    // 启动
    return this.start();
  }

  // ─── 安装 ─────────────────────────────────────────────

  /**
   * 确保 weixin-cli 已安装
   * 内部有缓存，多次调用不会重复安装
   */
  async ensureInstalled(): Promise<boolean> {
    if (this._installed) return true;
    if (this._installPromise) return this._installPromise;

    this._installPromise = this.doInstall();
    const result = await this._installPromise;
    this._installed = result;
    return result;
  }

  /** 实际执行安装 */
  private async doInstall(): Promise<boolean> {
    this._state = 'installing';
    this.emit('state', this._state);

    log('info', `正在安装 ${CLI_PACKAGE} ...`);

    try {
      // 使用 npx 执行安装命令
      const installOk = await this.runCommand(
        'npx',
        ['-y', `${CLI_PACKAGE}@latest`, 'install'],
        120_000 // 2 分钟超时
      );

      if (installOk) {
        this._state = 'installed';
        this._installed = true;
        log('info', `${CLI_PACKAGE} 安装成功`);
        this.emit('state', this._state);
        return true;
      }

      this._lastError = `${CLI_PACKAGE} 安装失败`;
      this._state = 'error';
      this.emit('state', this._state);
      return false;
    } catch (err) {
      this._lastError = `安装异常: ${(err as Error).message}`;
      this._state = 'error';
      log('error', '安装失败', this._lastError);
      this.emit('state', this._state);
      return false;
    }
  }

  // ─── 启动/停止 ───────────────────────────────────────

  /**
   * 启动 weixin-cli 服务
   * 启动后在子线程中持续捕获 stdout 以提取二维码
   */
  async start(): Promise<boolean> {
    if (this.running) {
      log('warn', 'weixin-cli 已在运行');
      return true;
    }

    this._state = 'starting';
    this._qrBase64 = null;
    this._qrRaw = null;
    this._stdoutBuf = '';
    this._lastError = null;
    this.emit('state', this._state);

    try {
      // 获取 weixin-cli 入口路径
      const binPath = this.resolveCliBinPath();

      if (!binPath) {
        this._lastError = '找不到 weixin-cli 入口文件';
        this._state = 'error';
        this.emit('state', this._state);
        return false;
      }

      log('info', `启动 weixin-cli: ${binPath}`);

      const proc = spawn('node', [binPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      this._process = proc;
      this._startedAt = Date.now();

      // 处理 stdout（从中提取二维码）
      proc.stdout?.on('data', (data: Buffer) => {
        this.handleStdout(data);
      });

      // 处理 stderr
      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        log('debug', 'weixin-cli stderr:', text.slice(0, 200));

        // stderr 也可能包含二维码信息
        this.handleStdout(data);
      });

      // 进程退出处理
      proc.on('exit', (code, signal) => {
        log('info', `weixin-cli 已退出 (code=${code}, signal=${signal})`);
        this._process = null;
        this._state = 'idle';
        this.emit('state', this._state);
        this.emit('exit', { code, signal });
      });

      proc.on('error', (err) => {
        log('error', 'weixin-cli 进程异常', err.message);
        this._lastError = err.message;
        this._state = 'error';
        this._process = null;
        this.emit('state', this._state);
        this.emit('error', err);
      });

      // 等待几秒检测是否正常启动
      await new Promise<void>((resolve) => {
        const check = () => {
          if (proc.exitCode !== null) {
            // 进程已退出，启动失败
            resolve();
            return;
          }
          // 启动成功（至少进程活着）
          this._state = 'waiting_scan';
          this.emit('state', this._state);
          resolve();
        };

        // 等待 2 秒后检测
        setTimeout(check, 2_000);
      });

      if (proc.exitCode !== null) {
        this._lastError = `weixin-cli 启动后立即退出 (code=${proc.exitCode})`;
        this._state = 'error';
        this.emit('state', this._state);
        return false;
      }

      log('info', 'weixin-cli 已启动，等待扫码中...');
      return true;
    } catch (err) {
      this._lastError = `启动异常: ${(err as Error).message}`;
      this._state = 'error';
      log('error', '启动失败', this._lastError);
      this.emit('state', this._state);
      return false;
    }
  }

  /**
   * 停止 weixin-cli 服务
   */
  async stop(): Promise<void> {
    if (!this._process) {
      this._state = 'idle';
      return;
    }

    log('info', '正在停止 weixin-cli ...');

    return new Promise((resolve) => {
      const proc = this._process!;
      const timeout = setTimeout(() => {
        // 超时强制杀死
        try {
          proc.kill('SIGKILL');
        } catch (err) {
          // ignore

          logger.debug('Operation skipped', {
            context: 'ignore',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }, 10_000);

      proc.on('exit', () => {
        clearTimeout(timeout);
        this._process = null;
        this._state = 'idle';
        this.emit('state', this._state);
        resolve();
      });

      // 先 SIGTERM 优雅退出
      try {
        proc.kill('SIGTERM');
      } catch (err) {
        // ignore

        logger.debug('Operation skipped', {
          context: 'ignore',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  // ─── stdout 处理 ─────────────────────────────────────

  /** 处理 stdout 数据，提取二维码 */
  private handleStdout(data: Buffer): void {
    const text = data.toString('utf-8');
    this._stdoutBuf += text;

    // 控制台输出日志
    const lines = text.split('\n').filter(Boolean);
    for (const line of lines) {
      log('debug', `[weixin-cli] ${line.slice(0, 300)}`);
    }

    // 尝试从当前行提取二维码 URL
    for (const line of lines) {
      // 匹配 URL 形式的二维码
      const urlMatch = line.match(QR_LINE_REGEX);
      if (urlMatch) {
        this._qrRaw = urlMatch[1];
        log('info', '捕获到二维码 URL');
        this.emit('qr', { url: this._qrRaw, base64: this._qrBase64 });
      }

      // 检查是否包含二维码关键词
      if (QR_RAW_REGEX.test(line)) {
        log('info', '检测到二维码输出');
        this.emit('qr_detected', { line: line.slice(0, 200) });
      }
    }

    // 如果状态是 waiting_scan 且捕获到了二维码，可以通知前端
    if (this._qrRaw && this._state === 'waiting_scan') {
      this._state = 'waiting_scan';
      this.emit('state', this._state);
    }
  }

  // ─── 辅助方法 ─────────────────────────────────────────

  /**
   * 运行一个命令并等待完成
   * @returns true 表示退出码为 0
   */
  private runCommand(
    cmd: string,
    args: string[],
    timeoutMs: number
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        stdio: 'inherit',
        shell: true,
        timeout: timeoutMs,
      });

      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch (err) {
          // ignore

          logger.debug('Operation skipped', {
            context: 'ignore',
            error: err instanceof Error ? err.message : String(err),
          });
        }
        resolve(false);
      }, timeoutMs);

      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });

      child.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  }

  /**
   * 解析 weixin-cli 的入口文件路径
   * 通过 npx 寻找已安装包的入口
   */
  private resolveCliBinPath(): string | null {
    try {
      // 尝试 resolve 包入口
      const pkgJsonPath = require.resolve(`${CLI_PACKAGE}/package.json`);
      const pkgDir = path.dirname(pkgJsonPath);
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));

      // 优先使用 bin 字段，其次 main
      const entry =
        (pkg.bin as Record<string, string>)?.[Object.keys(pkg.bin || {})[0]] ||
        pkg.main ||
        'index.js';

      const entryPath = path.resolve(pkgDir, entry);
      if (fs.existsSync(entryPath)) {
        return entryPath;
      }

      // fallback: 直接找 index.js
      const indexPath = path.resolve(pkgDir, 'index.js');
      if (fs.existsSync(indexPath)) return indexPath;

      return null;
    } catch {
      // require.resolve 失败，尝试通过 npx 路径寻找
      return null;
    }
  }

  /** 重置管理器（主要用于测试） */
  reset(): void {
    this._state = 'idle';
    this._process = null;
    this._qrBase64 = null;
    this._qrRaw = null;
    this._lastError = null;
    this._stdoutBuf = '';
    this._installed = false;
    this._installPromise = null;
  }
}
