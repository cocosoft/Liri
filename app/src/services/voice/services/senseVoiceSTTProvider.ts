/**
 * SenseVoiceSTTProvider
 * SenseVoice STT 提供者（通过 sherpa-onnx）
 *
 * SenseVoice 是阿里开源的语音识别模型，对中文识别准确率更高。
 * 通过长驻 Python sherpa-onnx 进程实现本地语音转文字。
 *
 * 依赖：
 * - Python 3.8+
 * - sherpa-onnx (`pip install sherpa-onnx`)
 * - SenseVoiceSmall 模型（首次使用需手动下载，详见下方"模型下载"）
 *
 * 模型下载（代码不自动下载，首次使用前需手动放置）：
 *   目标路径: <models>/sherpa-onnx/SenseVoiceSmall/model.onnx
 *   官方下载: https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17
 *   国内镜像: https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17
 *
 * 用法：
 * ```ts
 * import { SenseVoiceSTTProvider } from './senseVoiceSTTProvider';
 * STTRegistry.register(new SenseVoiceSTTProvider());
 * ```
 */

import { spawn, ChildProcess, execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join, isAbsolute, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import {
  writeFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'fs';
import { Logger, LogLevel, getOTelTracing } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { getPlatform } from '@modules/utils/platform';
import { resolveModelsDir } from '@modules/core/paths';
import type { STTProvider, STTStreamConnection } from './sttProvider';
import type {
  STTProviderType,
  STTResult,
  STTTranscribeOptions,
  STTStreamOptions,
} from '../models/types';

const logger = new Logger({ module: 'voice:stt:senseVoice' });

/** SenseVoice STT 提供者标识 */
const PROVIDER_ID = 'sensevoice';
const PROVIDER_NAME = 'SenseVoice (sherpa-onnx)';

/** Python 可执行文件名称（平台相关） */
const PYTHON_CMD = getPlatform() === 'win32' ? 'python' : 'python3';

/** 3.9/P2-5：worker 脚本目录（当前文件所在目录，独立 .py 随代码分发） */
const workerScriptDir = dirname(fileURLToPath(import.meta.url));

/**
 * 构建 SenseVoice 长驻 Python 工作进程脚本（3.9/P2-5：脚本独立文件 sensevoice_worker.py）
 *
 * 使用 sherpa-onnx OfflineRecognizer 进行语音识别（详见 sensevoice_worker.py 头部协议注释）。
 */
function buildSenseVoiceWorkerScript(): string {
  return readFileSync(join(workerScriptDir, 'sensevoice_worker.py'), 'utf-8');
}

/** 默认配置 */
const DEFAULT_CONFIG = {
  model: 'SenseVoiceSmall',
  device: 'cpu',
  pythonCmd: PYTHON_CMD,
  hfEndpoint: '',
};

/** 允许的 SenseVoice 模型 */
const ALLOWED_MODELS = ['SenseVoiceSmall'] as const;

/** SenseVoiceSTTProvider 配置项 */
export interface SenseVoiceSTTConfig {
  /** SenseVoice 模型名称 */
  model?: string;
  /** 计算设备（cpu/cuda） */
  device?: string;
  /** Python 可执行文件路径 */
  pythonCmd?: string;
  /**
   * HuggingFace 镜像端点
   * 国内用户可设置为 https://hf-mirror.com 加速模型下载
   */
  hfEndpoint?: string;
}

/**
 * 待处理请求描述
 */
interface PendingRequest {
  resolve: (result: string) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  startTime: number;
}

/** 单次转录请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 60_000;

/** 进程崩溃后最大重启次数 */
const MAX_RESTART_ATTEMPTS = 3;

/** 重启间隔（毫秒） */
const RESTART_DELAY_MS = 1_000;

/**
 * SenseVoice STT 提供者
 * 通过长驻 Python sherpa-onnx 进程实现语音转文字
 */
export class SenseVoiceSTTProvider implements STTProvider {
  readonly id = PROVIDER_ID;
  readonly name = PROVIDER_NAME;
  readonly type: STTProviderType = 'local';
  readonly supportsStreaming = false;
  readonly supportsKeyterms = false;

  private config: SenseVoiceSTTConfig;

  /** 可用性缓存 TTL（毫秒） */
  private static readonly AVAILABILITY_TTL = 60_000;

  /** 上次探测时间戳 */
  private _lastProbeAt = 0;

  /** 缓存的最新可用性结果 */
  private _cachedAvailable = false;

  // ===== 长驻进程管理 =====

  /** Python 工作进程 */
  private _workerProcess: ChildProcess | null = null;

  /** 工作进程脚本路径 */
  private _workerScriptPath: string | null = null;

  /** 输出缓冲区 */
  private _stdoutBuffer = '';

  /** 待处理请求映射表 */
  private _pendingRequests = new Map<string, PendingRequest>();

  /** 请求 ID 计数器 */
  private _requestIdCounter = 0;

  /** 进程是否已就绪 */
  private _workerReady = false;

  /** 进程是否正在关闭 */
  private _disposing = false;

  /** 当前重启次数 */
  private _restartCount = 0;

  /** 上次使用的模型配置快照（检测变更用） */
  private _lastModelConfig: {
    model: string;
    device: string;
  } | null = null;

  constructor(config: SenseVoiceSTTConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 更新配置
   * 如果 model/device 变更，将触发工作进程重启
   */
  updateConfig(config: Partial<SenseVoiceSTTConfig>): void {
    const oldModelConfig = {
      model: this.config.model!,
      device: this.config.device!,
    };

    this.config = { ...this.config, ...config };

    // 重置可用性缓存
    this._lastProbeAt = 0;
    this._cachedAvailable = false;

    // 如果模型配置变更且进程已启动，重启工作进程
    const newModelConfig = {
      model: this.config.model!,
      device: this.config.device!,
    };
    if (
      this._workerProcess &&
      (oldModelConfig.model !== newModelConfig.model ||
        oldModelConfig.device !== newModelConfig.device)
    ) {
      this._lastModelConfig = null;
      this.restartWorker().catch((err) => {
        logger.warn('SenseVoice 配置变更后重启工作进程失败', {
          error: String(err),
        });
      });
    }
  }

  /**
   * 检查提供者是否可用
   * 通过检测 Python 环境和 sherpa-onnx 模块来判断
   */
  isAvailable(): boolean {
    if (
      Date.now() - this._lastProbeAt <
      SenseVoiceSTTProvider.AVAILABILITY_TTL
    ) {
      return this._cachedAvailable;
    }

    try {
      // 3.10/P2-6：execFileSync 参数数组（杜绝 shell 拼接注入）+ pythonCmd 白名单/路径校验
      assertSafePythonCmd(this.config.pythonCmd!);
      execFileSync(
        this.config.pythonCmd!,
        ['-c', "import sherpa_onnx; print('ok')"],
        { stdio: 'pipe', timeout: 5000 }
      );
      this._cachedAvailable = true;
      this._lastProbeAt = Date.now();
      return true;
    } catch (err) {
      this._cachedAvailable = false;
      this._lastProbeAt = Date.now();
      return false;
    }
  }

  /**
   * 文件级转录
   */
  async transcribe(
    audioData: Buffer,
    options?: STTTranscribeOptions
  ): Promise<STTResult> {
    const audioPath = join(tmpdir(), `stt_sv_${randomUUID()}.wav`);
    const language = options?.language ? options.language.split('-')[0] : 'zh';

    const otel = getOTelTracing();
    return otel.wrap(
      {
        name: 'voice.sensevoice.stt.transcribe',
        attributes: {
          model: this.config.model!,
          language,
          audioSize: audioData.length,
        },
      },
      async () => {
        try {
          // 参数验证
          validateSenseVoiceConfig(this.config.model!);

          // 写入音频临时文件
          writeFileSync(audioPath, audioData);

          // 确保长驻进程已启动
          await this.ensureWorker();

          // 发送转录请求
          const resultJson = await this.sendRequest(audioPath, language);
          const parsed = JSON.parse(resultJson);

          return {
            text: parsed.text || '',
            confidence: parsed.segments?.[0]?.confidence ?? 0,
            isFinal: true,
            duration: parsed.duration || 0,
            language: parsed.language || language,
            provider: PROVIDER_ID,
            segments: parsed.segments || [],
          };
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          void handleError(error, {
            module: 'services:voice:senseVoiceSTT',
            action: 'transcribe',
          });

          return {
            text: '',
            confidence: 0,
            isFinal: true,
            duration: 0,
            language,
            provider: PROVIDER_ID,
            error: { code: 'TRANSCRIBE_FAILED', message: errorMsg },
          };
        } finally {
          try {
            unlinkSync(audioPath);
          } catch (err) {
            // 临时文件清理失败不影响主流程
          }
        }
      }
    )();
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this._disposing = true;
    this.shutdownWorker();
    this.cleanupWorkerScript();
  }

  /**
   * SenseVoice 不支持流式转录
   */
  createStream(_options?: STTStreamOptions): STTStreamConnection {
    throw new Error('SenseVoiceSTTProvider 不支持流式转录');
  }

  // ===== 长驻进程管理 =====

  /**
   * 确保长驻进程已启动并就绪
   */
  private async ensureWorker(): Promise<void> {
    const currentModelConfig = {
      model: this.config.model!,
      device: this.config.device!,
    };

    // 配置变更需要重启
    if (
      this._workerProcess &&
      this._lastModelConfig &&
      (this._lastModelConfig.model !== currentModelConfig.model ||
        this._lastModelConfig.device !== currentModelConfig.device)
    ) {
      await this.restartWorker();
      return;
    }

    // 进程已启动且就绪
    if (
      this._workerProcess &&
      this._workerReady &&
      this._workerProcess.exitCode === null
    ) {
      return;
    }

    // 进程未启动或已退出，启动新进程
    if (!this._workerProcess || this._workerProcess.exitCode !== null) {
      await this.startWorker();
      return;
    }

    // 进程已启动但未就绪，等待就绪
    if (!this._workerReady) {
      await this.waitForReady();
    }
  }

  /**
   * 启动长驻 Python 工作进程
   */
  private async startWorker(): Promise<void> {
    this._workerReady = false;
    this._stdoutBuffer = '';

    // 写入工作进程脚本
    this.ensureWorkerScript();

    const initConfig = JSON.stringify({
      model: this.config.model!,
      device: this.config.device!,
      download_root: resolveModelsDir(),
    });

    const proc = spawn(this.config.pythonCmd!, [this._workerScriptPath!], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...(process.env as Record<string, string>),
        ...(this.config.hfEndpoint
          ? { HF_ENDPOINT: this.config.hfEndpoint }
          : {}),
      },
    });

    this._workerProcess = proc;
    this._lastModelConfig = {
      model: this.config.model!,
      device: this.config.device!,
    };

    // 处理 stdout
    proc.stdout!.on('data', (chunk: Buffer) => {
      this.handleStdout(chunk.toString());
    });

    // 处理 stderr
    proc.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        logger.debug('[SenseVoice Worker]', { stderr: text });
      }
    });

    // 处理进程退出
    proc.on('exit', (code, signal) => {
      logger.info('SenseVoice 工作进程已退出', { code, signal });

      this.rejectAllPending(
        new Error(
          `SenseVoice 工作进程异常退出 (code=${code}, signal=${signal})`
        )
      );

      // 自动重启
      if (!this._disposing && this._restartCount < MAX_RESTART_ATTEMPTS) {
        this._restartCount++;
        setTimeout(() => {
          if (!this._disposing) {
            this.startWorker().catch((err) => {
              void handleError(err, {
                module: 'services:voice:sense',
                action: '重启工作进程失败',
              });
            });
          }
        }, RESTART_DELAY_MS);
      }
    });

    proc.on('error', (err) => {
      void handleError(err, {
        module: 'services:voice:sense',
        action: '工作进程错误',
      });
    });

    // 发送初始配置
    proc.stdin!.write(initConfig + '\n');

    // 等待就绪
    await this.waitForReady();
  }

  /**
   * 重启工作进程
   */
  private async restartWorker(): Promise<void> {
    this.shutdownWorker();
    this._restartCount = 0;
    await this.startWorker();
  }

  /**
   * 关闭工作进程
   */
  private shutdownWorker(): void {
    const proc = this._workerProcess;
    if (!proc || proc.exitCode !== null) {
      this._workerProcess = null;
      this._workerReady = false;
      return;
    }

    try {
      proc.stdin!.write(JSON.stringify({ command: 'shutdown' }) + '\n');
    } catch (err) {
      // 写入失败，直接 kill
    }

    const killTimeout = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch (err) {
        // 进程可能已自然退出
      }
    }, 3000);

    proc.on('exit', () => {
      clearTimeout(killTimeout);
    });

    this._workerProcess = null;
    this._workerReady = false;
  }

  /**
   * 等待工作进程就绪
   */
  private waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('等待 SenseVoice 工作进程就绪超时（30s）'));
      }, 30_000);

      const check = (): void => {
        if (this._workerReady) {
          clearTimeout(timeout);
          resolve();
          return;
        }
        if (this._workerProcess?.exitCode !== null) {
          clearTimeout(timeout);
          reject(new Error('SenseVoice 工作进程在就绪前已退出'));
          return;
        }
        setTimeout(check, 100);
      };
      check();
    });
  }

  // ===== 请求-响应管理 =====

  /**
   * 发送转录请求到工作进程并等待结果
   */
  private sendRequest(audioPath: string, language: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const reqId = `sv_${++this._requestIdCounter}`;
      const startTime = Date.now();

      const timeout = setTimeout(() => {
        this._pendingRequests.delete(reqId);
        const elapsed = Date.now() - startTime;
        reject(
          new Error(
            `SenseVoice 转录请求超时 (${REQUEST_TIMEOUT_MS}ms, 实际等待 ${elapsed}ms)`
          )
        );
      }, REQUEST_TIMEOUT_MS);

      this._pendingRequests.set(reqId, { resolve, reject, timeout, startTime });

      try {
        const request = JSON.stringify({
          id: reqId,
          audio_path: audioPath,
          language,
        });

        this._workerProcess?.stdin?.write(request + '\n');
      } catch (err) {
        this._pendingRequests.delete(reqId);
        clearTimeout(timeout);
        reject(
          new Error(
            `发送请求到 SenseVoice 工作进程失败: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      }
    });
  }

  /**
   * 处理 stdout 数据（按行分割 JSON 响应）
   */
  private handleStdout(chunk: string): void {
    this._stdoutBuffer += chunk;

    const lines = this._stdoutBuffer.split('\n');
    this._stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const response = JSON.parse(trimmed);

        // 就绪信号
        if (response.status === 'ready') {
          this._workerReady = true;
          this._restartCount = 0;
          logger.info('SenseVoice 工作进程已就绪');
          continue;
        }

        // 请求响应
        const reqId = response.id;
        if (reqId && this._pendingRequests.has(reqId)) {
          const pending = this._pendingRequests.get(reqId)!;
          this._pendingRequests.delete(reqId);
          clearTimeout(pending.timeout);

          if (response.status === 'ok') {
            pending.resolve(JSON.stringify(response));
          } else {
            pending.reject(
              new Error(response.message || 'SenseVoice 转录错误')
            );
          }
        }
      } catch (err) {
        logger.warn('解析 SenseVoice 工作进程输出失败', {
          line: trimmed,
          error: String(err),
        });
      }
    }
  }

  /**
   * 拒绝所有待处理请求
   */
  private rejectAllPending(error: Error): void {
    for (const [reqId, pending] of this._pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this._pendingRequests.clear();
    this._workerReady = false;
  }

  // ===== 脚本文件管理 =====

  /**
   * 确保工作进程脚本已写入磁盘
   */
  private ensureWorkerScript(): void {
    if (this._workerScriptPath && existsSync(this._workerScriptPath)) {
      return;
    }

    const tmpDir = join(tmpdir(), 'py_app_sensevoice');
    if (!existsSync(tmpDir)) {
      mkdirSync(tmpDir, { recursive: true });
    }

    this._workerScriptPath = join(tmpDir, 'sensevoice_worker.py');
    writeFileSync(
      this._workerScriptPath,
      buildSenseVoiceWorkerScript(),
      'utf-8'
    );
  }

  /**
   * 清理工作进程脚本
   */
  private cleanupWorkerScript(): void {
    if (this._workerScriptPath) {
      try {
        unlinkSync(this._workerScriptPath);
      } catch (err) {
        // 清理失败不影响主流程
      }
      this._workerScriptPath = null;
    }
  }
}

// ===== 验证函数 =====

/**
 * 校验 pythonCmd 安全性（3.10/P2-6）
 *
 * 仅允许常见的裸命令名（python/python3 等，无路径分隔符与空白）或绝对路径，
 * 防止在 spawn/execFile 之前被注入 shell 元字符。
 *
 * @throws 非法 pythonCmd 时抛出错误
 */
function assertSafePythonCmd(cmd: string): void {
  if (isAbsolute(cmd)) return;
  if (/[\\/\s]/.test(cmd)) {
    throw new Error(
      `非法 pythonCmd: "${cmd}"（仅允许 python/python3 等命令名或绝对路径）`
    );
  }
}

/**
 * 验证 SenseVoice 配置参数
 *
 * @throws 当参数不在白名单中时抛出错误
 */
function validateSenseVoiceConfig(model: string): void {
  if (!(ALLOWED_MODELS as readonly string[]).includes(model)) {
    throw new Error(
      `不支持的模型 "${model}"，允许值: ${ALLOWED_MODELS.join(', ')}`
    );
  }
}
