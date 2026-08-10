/**
 * LocalSTTProvider
 * 本地 STT 提供者
 * 通过长驻 Python faster-whisper 进程实现本地语音转文字
 *
 * 改进（M6）：从每次转录启动新进程改为长驻进程模式
 * - 首次转录时启动 Python 进程并加载模型
 * - 后续转录通过 stdin/stdout JSON-line 协议复用同一进程
 * - 配置变更（model/device/computeType）自动重启进程
 * - 进程崩溃自动重启（最多 3 次）
 * - 单次请求超时保护（30s）
 *
 * 依赖：
 * - Python 3.8+
 * - faster-whisper (`pip install faster-whisper`)
 *
 * 用法：
 * ```ts
 * import { LocalSTTProvider } from './localSTTProvider';
 * STTRegistry.register(new LocalSTTProvider());
 * ```
 */

import { spawn, ChildProcess } from 'child_process';
import { tmpdir } from 'os';
import { join, isAbsolute, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  readFileSync,
} from 'fs';
import { getLogger, getOTelTracing } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { getPlatform } from '@modules/utils/platform';
import { resolveModelsDir } from '@modules/core/paths';
// 2026-08-06 接入（3.2/P1-2）：stdin 二进制直传，需嗅探容器以决定如何打包 PCM
import { detectAudioContainer } from './audioNormalizer';
import type { STTProvider, STTStreamConnection } from './sttProvider';
import type {
  STTProviderType,
  STTResult,
  STTTranscribeOptions,
  STTStreamOptions,
} from '../models/types';

const logger = getLogger('voice:stt:local');

/** 本地 STT 提供者标识 */
const PROVIDER_ID = 'local';
const PROVIDER_NAME = 'Local Whisper';

/** Python 可执行文件名称（平台相关） */
const PYTHON_CMD = getPlatform() === 'win32' ? 'python' : 'python3';

/** 3.9/P2-5：worker 脚本目录（当前文件所在目录，独立 .py 随代码分发） */
const workerScriptDir = dirname(fileURLToPath(import.meta.url));

/**
 * 构建长驻 Python 工作进程脚本（3.9/P2-5：脚本独立文件 whisper_worker.py）
 *
 * stdin/stdout 协议（详见 whisper_worker.py 头部协议注释）：
 *   stdin 首行整包配置；请求 protocol=2 二进制直传（首行 JSON 头 + 原始 PCM16 二进制体），
 *   protocol=1 保留 audio_path 兼容分支；stdout JSON 行（ready / chunk / finalize / error）。
 */
export function buildWorkerScript(): string {
  // 独立 .py 文件随代码分发，避免 TS 模板字符串转义与维护成本
  return readFileSync(join(workerScriptDir, 'whisper_worker.py'), 'utf-8');
}

/** 默认配置 */
const DEFAULT_CONFIG = {
  model: 'base',
  device: 'cpu',
  computeType: 'int8',
  beamSize: 5,
  vadFilter: true,
  vadMinSilenceMs: 500,
  pythonCmd: PYTHON_CMD,
  hfEndpoint: '',
};

/** 允许的模型大小（白名单） */
const ALLOWED_MODELS = ['tiny', 'base', 'small', 'medium', 'large-v3'] as const;

/** 允许的计算设备 */
const ALLOWED_DEVICES = ['cpu', 'cuda'] as const;

/** 允许的计算精度 */
const ALLOWED_COMPUTE_TYPES = ['int8', 'float16', 'float32'] as const;

/** 语言代码格式（ISO 639-1 两字母代码） */
const LANGUAGE_CODE_REGEX = /^[a-z]{2,3}$/;

/** 单次转录请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 30_000;

/** 进程崩溃后最大重启次数 */
const MAX_RESTART_ATTEMPTS = 3;

/** 重启间隔（毫秒） */
const RESTART_DELAY_MS = 1_000;

/**
 * stdin 直传音频上限（字节，25MB，对齐方案 §6 风险缓解承诺）
 * 超过该体积一次性读入内存会撑爆 Python worker 进程，
 * 超限抛错交 registry 故障转移 / 提示用户分片。
 */
const MAX_AUDIO_INPUT_BYTES = 25 * 1024 * 1024;

/**
 * stdin 音频大小校验（§6 风险缓解）
 * 超过 25MB 一次性读入会撑爆 worker 进程，抛错交 registry 故障转移。
 */
export function assertAudioInputSize(audioData: Buffer): void {
  if (audioData.length > MAX_AUDIO_INPUT_BYTES) {
    throw new Error(
      `本地 STT 音频超过 ${Math.round(MAX_AUDIO_INPUT_BYTES / 1024 / 1024)}MB 上限，请分片转录或改用云端 STT`
    );
  }
}

/** LocalSTTProvider 配置项 */
export interface LocalSTTConfig {
  /** Whisper 模型大小（tiny/base/small/medium/large-v3） */
  model?: string;
  /** 计算设备（cpu/cuda） */
  device?: string;
  /** 计算精度（int8/float16/float32） */
  computeType?: string;
  /** Beam search 宽度 */
  beamSize?: number;
  /** 是否启用 VAD 过滤 */
  vadFilter?: boolean;
  /** VAD 最小静音时长（毫秒） */
  vadMinSilenceMs?: number;
  /** Python 可执行文件路径 */
  pythonCmd?: string;
  /**
   * HuggingFace 镜像端点
   * 国内用户可设置为 https://hf-mirror.com 加速模型下载
   * 留空则使用官方 huggingface.co
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

/**
 * 本地 STT 提供者
 * 通过长驻 Python faster-whisper 进程实现语音转文字
 */
export class LocalSTTProvider implements STTProvider {
  readonly id = PROVIDER_ID;
  readonly name = PROVIDER_NAME;
  readonly type: STTProviderType = 'local';
  readonly supportsStreaming = false;
  readonly supportsKeyterms = false;

  private config: LocalSTTConfig;

  /** 可用性缓存 TTL（毫秒） */
  private static readonly AVAILABILITY_TTL = 60_000;

  /** 上次探测时间戳 */
  private _lastProbeAt = 0;

  /** 缓存的最新可用性结果 */
  private _cachedAvailable = false;

  // ===== 长驻进程管理 =====

  /** Python 工作进程 */
  private _workerProcess: ChildProcess | null = null;

  /** 工作进程脚本路径（写入一次，复用到进程重启） */
  private _workerScriptPath: string | null = null;

  /** 输出缓冲区（按行分割，处理跨块换行） */
  private _stdoutBuffer = '';

  /** 待处理请求映射表（requestId -> PendingRequest） */
  private _pendingRequests = new Map<string, PendingRequest>();

  /** 请求 ID 计数器 */
  private _requestIdCounter = 0;

  /** 进程是否已就绪（收到 ready 信号） */
  private _workerReady = false;

  /** 进程是否正在关闭（阻止自动重启） */
  private _disposing = false;

  /** 当前重启次数 */
  private _restartCount = 0;

  /** 上次使用的模型配置快照（检测变更用） */
  private _lastModelConfig: {
    model: string;
    device: string;
    computeType: string;
  } | null = null;

  constructor(config: LocalSTTConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 更新配置
   * 如果 model/device/computeType 变更，将触发工作进程重启
   */
  updateConfig(config: Partial<LocalSTTConfig>): void {
    const oldModelConfig = {
      model: this.config.model!,
      device: this.config.device!,
      computeType: this.config.computeType!,
    };

    this.config = { ...this.config, ...config };

    // 重置可用性缓存
    this._lastProbeAt = 0;
    this._cachedAvailable = false;

    // 如果模型配置变更且进程已启动，重启工作进程
    const newModelConfig = {
      model: this.config.model!,
      device: this.config.device!,
      computeType: this.config.computeType!,
    };
    if (
      this._workerProcess &&
      (oldModelConfig.model !== newModelConfig.model ||
        oldModelConfig.device !== newModelConfig.device ||
        oldModelConfig.computeType !== newModelConfig.computeType)
    ) {
      this._lastModelConfig = null;
      this.restartWorker().catch((err) => {
        logger.warn('配置变更后重启工作进程失败', { error: String(err) });
      });
    }
  }

  /**
   * 检查提供者是否可用
   *
   * 通过检测 Python 环境和 faster-whisper 模块来判断，结果缓存 60 秒。
   */
  isAvailable(): boolean {
    // 缓存有效期内直接返回
    if (Date.now() - this._lastProbeAt < LocalSTTProvider.AVAILABILITY_TTL) {
      return this._cachedAvailable;
    }

    try {
      // 3.10/P2-6：execFileSync 参数数组（杜绝 shell 拼接注入）+ pythonCmd 白名单/路径校验
      const { execFileSync } = require('child_process');
      assertSafePythonCmd(this.config.pythonCmd!);
      execFileSync(
        this.config.pythonCmd!,
        ['-c', 'import faster_whisper; print(faster_whisper.__version__)'],
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
   * 3.2/P1-2：stdin「首行 JSON 头 + 原始 PCM 二进制体」直传长驻进程，不再写临时文件。
   *
   * 音频格式处理（配合 3.1 入口归一化）：
   * - WAV（有 RIFF 头）→ 解析头提取采样率/声道，剥离头后直传 PCM
   * - PCM16 原始字节（3.1 ffmpeg 转码产物或原生 PCM）→ 直传，默认 16k mono
   * - webm/ogg/mp4（ffmpeg 不可用时入口透传）→ 本地 worker 无法解析，抛错交故障转移
   *
   * @param audioData 音频数据（WAV/PCM）
   * @param options 转录选项
   */
  async transcribe(
    audioData: Buffer,
    options?: STTTranscribeOptions
  ): Promise<STTResult> {
    const language = options?.language ? options.language.split('-')[0] : 'en';
    const model = options?.model || this.config.model!;

    const otel = getOTelTracing();
    return otel.wrap(
      {
        name: 'voice.local.stt.transcribe',
        attributes: { model, language, audioSize: audioData.length },
      },
      async () => {
        try {
          // 参数白名单验证
          validateConfig(
            model,
            this.config.device!,
            this.config.computeType!,
            language
          );

          // §6 风险缓解：stdin 一次性读入上限 25MB，超限抛错交故障转移
          assertAudioInputSize(audioData);

          // 确保长驻进程已启动并就绪
          await this.ensureWorker();

          // 嗅探容器 → 决定如何打包 PCM 载荷
          const container = detectAudioContainer(audioData);
          let pcm: Buffer;
          let sampleRate: number;
          let channels: number;
          if (container === 'wav') {
            const wav = parseWavHeader(audioData);
            if (!wav) {
              throw new Error(
                '本地 STT 无法解析 WAV 头（数据损坏或非 PCM 编码）'
              );
            }
            pcm = audioData.subarray(wav.dataOffset);
            sampleRate = wav.sampleRate;
            channels = wav.channels;
          } else if (
            container === 'webm' ||
            container === 'ogg' ||
            container === 'mp4'
          ) {
            // 入口 ffmpeg 不可用时透传的原格式，worker 无法解析 → 抛错触发 registry 故障转移
            throw new Error(
              `本地 STT 无法解析 ${container} 格式（请安装 ffmpeg 或使用云端 STT）`
            );
          } else {
            // PCM16 原始字节（转码产物或原生 PCM），默认 16k mono
            pcm = audioData;
            sampleRate = 16000;
            channels = 1;
          }

          // 发送二进制转录请求并等待结果
          const resultJson = await this.sendBinaryRequest(pcm, {
            sampleRate,
            channels,
            language,
            options,
          });
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
            module: 'services:voice:localSTT',
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
        }
      }
    )();
  }

  /**
   * 释放资源
   * 关闭长驻 Python 进程并清理临时脚本文件
   */
  dispose(): void {
    this._disposing = true;
    this.shutdownWorker();
    this.cleanupWorkerScript();
  }

  /**
   * LocalSTTProvider 不支持流式转录
   */
  createStream(_options?: STTStreamOptions): STTStreamConnection {
    throw new Error('LocalSTTProvider 不支持流式转录');
  }

  // ===== 长驻进程管理 =====

  /**
   * 确保长驻进程已启动并就绪
   * 如果进程未启动、已崩溃或配置变更，则启动新进程
   */
  private async ensureWorker(): Promise<void> {
    const currentModelConfig = {
      model: this.config.model!,
      device: this.config.device!,
      computeType: this.config.computeType!,
    };

    // 配置变更需要重启
    if (
      this._workerProcess &&
      this._lastModelConfig &&
      (this._lastModelConfig.model !== currentModelConfig.model ||
        this._lastModelConfig.device !== currentModelConfig.device ||
        this._lastModelConfig.computeType !== currentModelConfig.computeType)
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

    // 进程已启动但未就绪，等待就绪
    if (
      this._workerProcess &&
      !this._workerReady &&
      this._workerProcess.exitCode === null
    ) {
      await this.waitForReady();
      return;
    }

    // 进程未启动或已退出，启动新进程
    await this.startWorker();
  }

  /**
   * 启动长驻 Python 工作进程
   */
  private async startWorker(): Promise<void> {
    this._workerReady = false;

    // 写入工作进程脚本（仅首次写入，后续复用）
    this.ensureWorkerScript();

    // 构建初始配置 JSON（整包配置对象传给 Python）
    const initConfig = JSON.stringify({
      model: this.config.model!,
      device: this.config.device!,
      compute_type: this.config.computeType!,
      beam_size: this.config.beamSize,
      vad_filter: this.config.vadFilter,
      vad_min_silence_ms: this.config.vadMinSilenceMs,
      download_root: resolveModelsDir(),
      pid: process.pid,
    });

    const procEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
    };
    // 国内用户可通过 hfEndpoint 配置 HuggingFace 镜像（如 https://hf-mirror.com）
    if (this.config.hfEndpoint) {
      procEnv['HF_ENDPOINT'] = this.config.hfEndpoint;
    }

    const proc = spawn(this.config.pythonCmd!, [this._workerScriptPath!], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: procEnv,
    });

    this._workerProcess = proc;
    this._lastModelConfig = {
      model: this.config.model!,
      device: this.config.device!,
      computeType: this.config.computeType!,
    };

    // 处理 stdout（按行分割）
    proc.stdout!.on('data', (chunk: Buffer) => {
      this.handleStdout(chunk.toString());
    });

    // 处理 stderr（仅日志记录）
    proc.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        logger.debug('[Whisper Worker]', { stderr: text });
      }
    });

    // 处理进程退出
    proc.on('exit', (code, signal) => {
      logger.info('Whisper 工作进程已退出', { code, signal });

      // 拒绝所有未完成的请求
      this.rejectAllPending(
        new Error(`工作进程异常退出 (code=${code}, signal=${signal})`)
      );

      // 自动重启（非 dispose 场景）
      if (!this._disposing && this._restartCount < MAX_RESTART_ATTEMPTS) {
        this._restartCount++;
        setTimeout(() => {
          if (!this._disposing) {
            this.startWorker().catch((err) => {
              void handleError(err, {
                module: 'services:voice:localSTT',
                action: '重启工作进程失败',
              });
            });
          }
        }, RESTART_DELAY_MS);
      }
    });

    proc.on('error', (err) => {
      void handleError(err, {
        module: 'services:voice:localSTT',
        action: '工作进程错误',
      });
    });

    // 发送初始配置
    proc.stdin!.write(initConfig + '\n');

    // 等待就绪信号
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
   * 发送 shutdown 命令，等待优雅退出，超时则强制 SIGKILL
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

    // 3 秒优雅退出超时，超时后强制终止
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
   * 轮询检查 _workerReady 标志，超时 30 秒
   */
  private waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('等待工作进程就绪超时（30s）'));
      }, 30_000);
      const check = (): void => {
        if (this._workerReady) {
          clearTimeout(timeout);
          resolve();
          return;
        }
        if (this._workerProcess?.exitCode !== null) {
          clearTimeout(timeout);
          reject(new Error('工作进程在就绪前已退出'));
          return;
        }
        setTimeout(check, 100);
      };
      check();
    });
  }

  // ===== 请求-响应管理 =====

  /**
   * 发送二进制转录请求到工作进程并等待结果
   *
   * 3.2/P1-2：stdin「首行 JSON 头 + 原始 PCM 二进制体」。头携带 protocol=2 与
   * audio_len，worker 端 `read_exact` 精确读满后继续循环读下一个请求头。
   * 不写临时文件、不 base64 膨胀，规避磁盘往返与 33% 体积开销。
   *
   * @param pcm PCM16 原始二进制数据（已剥离容器头）
   * @param meta 传输元数据
   * @returns 转录结果 JSON 字符串（response 对象序列化）
   */
  private sendBinaryRequest(
    pcm: Buffer,
    meta: {
      sampleRate: number;
      channels: number;
      language: string;
      options?: STTTranscribeOptions;
    }
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const reqId = `req_${++this._requestIdCounter}`;
      const startTime = Date.now();

      // 单次请求超时保护
      const timeout = setTimeout(() => {
        this._pendingRequests.delete(reqId);
        const elapsed = Date.now() - startTime;
        reject(
          new Error(
            `转录请求超时 (${REQUEST_TIMEOUT_MS}ms, 实际等待 ${elapsed}ms)`
          )
        );
      }, REQUEST_TIMEOUT_MS);

      this._pendingRequests.set(reqId, { resolve, reject, timeout, startTime });

      // 从 options 中提取 keyterms 作为 initial_prompt（间接支持关键词）
      let initialPrompt: string | undefined;
      if (meta.options?.keyterms?.length) {
        initialPrompt = meta.options.keyterms.join(', ');
      }

      try {
        // 首行 JSON 头：协议版本 + PCM 元信息；后接原始 PCM 二进制体
        const header = JSON.stringify({
          id: reqId,
          protocol: 2,
          audio_len: pcm.length,
          sample_rate: meta.sampleRate,
          channels: meta.channels,
          language: meta.language,
          initial_prompt: initialPrompt,
        });

        const stdin = this._workerProcess?.stdin;
        if (!stdin) {
          throw new Error('工作进程未就绪（stdin 不可用）');
        }
        stdin.write(header + '\n');
        stdin.write(pcm);
      } catch (err) {
        this._pendingRequests.delete(reqId);
        clearTimeout(timeout);
        reject(
          new Error(
            `发送请求到工作进程失败: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      }
    });
  }

  /**
   * 处理 stdout 数据
   * 按行分割，每行是一个 JSON 响应
   */
  private handleStdout(chunk: string): void {
    this._stdoutBuffer += chunk;

    const lines = this._stdoutBuffer.split('\n');
    // 最后一个元素可能是不完整行，留在缓冲区等待下次数据
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
          logger.info('Whisper 工作进程已就绪', { pid: response.pid });
          continue;
        }

        // 请求响应（按 requestId 分发）
        const reqId = response.id;
        if (reqId && this._pendingRequests.has(reqId)) {
          const pending = this._pendingRequests.get(reqId)!;
          this._pendingRequests.delete(reqId);
          clearTimeout(pending.timeout);

          if (response.status === 'ok') {
            pending.resolve(JSON.stringify(response));
          } else {
            pending.reject(new Error(response.message || '未知转录错误'));
          }
        }
      } catch (err) {
        logger.warn('解析工作进程输出失败', {
          line: trimmed,
          error: String(err),
        });
      }
    }
  }

  /**
   * 拒绝所有待处理请求
   * 在进程崩溃时调用，防止请求永久挂起
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
   * 脚本写入一次，后续进程重启时直接复用
   */
  private ensureWorkerScript(): void {
    if (this._workerScriptPath && existsSync(this._workerScriptPath)) {
      return;
    }

    const tmpDir = join(tmpdir(), 'py_app_whisper');
    if (!existsSync(tmpDir)) {
      mkdirSync(tmpDir, { recursive: true });
    }

    this._workerScriptPath = join(tmpDir, 'whisper_worker.py');
    writeFileSync(this._workerScriptPath, buildWorkerScript(), 'utf-8');
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
 * 解析 WAV 头，提取 PCM 元信息（3.2/P1-2）
 *
 * 遍历 RIFF chunk，定位 fmt 块读取采样率/声道数，返回 data 区偏移。
 * 仅支持未压缩 PCM（audioFormat=1）与 WAVE_FORMAT_EXTENSIBLE（0xFFFE，PCM 子类型）。
 *
 * @param buffer WAV 文件字节
 * @returns 采样率/声道数/data 偏移；无法解析返回 null
 */
export function parseWavHeader(
  buffer: Buffer
): { sampleRate: number; channels: number; dataOffset: number } | null {
  if (
    buffer.length < 44 ||
    buffer.toString('latin1', 0, 4) !== 'RIFF' ||
    buffer.toString('latin1', 8, 12) !== 'WAVE'
  ) {
    return null;
  }

  let offset = 12;
  let fmt: { sampleRate: number; channels: number } | null = null;
  let dataOffset: number | null = null;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('latin1', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkId === 'fmt ') {
      // fmt 块至少 16 字节
      if (offset + 8 + 16 > buffer.length) return null;
      const audioFormat = buffer.readUInt16LE(offset + 8);
      // 仅未压缩 PCM / extensible（PCM 子类型）
      if (audioFormat !== 1 && audioFormat !== 0xfffe) return null;
      fmt = {
        channels: buffer.readUInt16LE(offset + 10),
        sampleRate: buffer.readUInt32LE(offset + 12),
      };
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      break;
    }
    // chunk 按偶数字节对齐
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  if (!fmt || dataOffset === null) return null;
  return { ...fmt, dataOffset };
}

/**
 * 验证配置参数白名单
 * 防止无效配置值传入 Python 进程
 *
 * @throws 当参数不在白名单中时抛出错误
 */
function validateConfig(
  model: string,
  device: string,
  computeType: string,
  language: string
): void {
  if (!(ALLOWED_MODELS as readonly string[]).includes(model)) {
    throw new Error(
      `不支持的模型 "${model}"，允许值: ${ALLOWED_MODELS.join(', ')}`
    );
  }
  if (!(ALLOWED_DEVICES as readonly string[]).includes(device)) {
    throw new Error(
      `不支持的设备 "${device}"，允许值: ${ALLOWED_DEVICES.join(', ')}`
    );
  }
  if (!(ALLOWED_COMPUTE_TYPES as readonly string[]).includes(computeType)) {
    throw new Error(
      `不支持的计算精度 "${computeType}"，允许值: ${ALLOWED_COMPUTE_TYPES.join(', ')}`
    );
  }
  if (!LANGUAGE_CODE_REGEX.test(language)) {
    throw new Error(`不支持的语言代码 "${language}"`);
  }
}
