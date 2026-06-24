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
import { join } from 'path';
import { randomUUID } from 'crypto';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { Logger, LogLevel, getOTelTracing } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { getPlatform } from '@modules/utils/platform';
import type { STTProvider, STTStreamConnection } from './sttProvider';
import type {
  STTProviderType,
  STTResult,
  STTTranscribeOptions,
  STTStreamOptions,
} from '../models/types';

const logger = new Logger({});

/** 本地 STT 提供者标识 */
const PROVIDER_ID = 'local';
const PROVIDER_NAME = 'Local Whisper';

/** Python 可执行文件名称（平台相关） */
const PYTHON_CMD = getPlatform() === 'win32' ? 'python' : 'python3';

/**
 * 构建长驻 Python 工作进程脚本
 *
 * 启动时加载 faster-whisper 模型一次，通过 stdin/stdout JSON-line 协议通信：
 *
 * 输入（stdin 每行一个 JSON）：
 *   首行（整包配置）: {"model":"base","device":"cpu","compute_type":"int8","beam_size":5,"vad_filter":true,"vad_min_silence_ms":500,"pid":12345}
 *   请求（仅 per-request 数据）: {"id":"req-1","audio_path":"/tmp/1.wav","language":"en","initial_prompt":"..."}
 *   关闭: {"command":"shutdown"}
 *
 * 输出（stdout 每行一个 JSON）：
 *   就绪: {"status":"ready","pid":12345}
 *   成功: {"id":"req-1","status":"ok","text":"...","segments":[...],"language":"en","duration":2.5}
 *   失败: {"id":"req-1","status":"error","message":"..."}
 */
function buildWorkerScript(): string {
  return `
import sys, json, signal, traceback, warnings
import numpy as np
import soundfile as sf
from faster_whisper import WhisperModel

TARGET_SR = 16000

def resample_audio(audio_data, sample_rate):
    if sample_rate == TARGET_SR:
        return audio_data
    try:
        from scipy import signal
        duration = len(audio_data) / sample_rate
        target_len = int(duration * TARGET_SR)
        return signal.resample(audio_data, target_len)
    except ImportError:
        ratio = TARGET_SR / sample_rate
        target_len = int(len(audio_data) * ratio)
        indices = (np.arange(target_len) / ratio).astype(int)
        indices = np.clip(indices, 0, len(audio_data) - 1)
        return audio_data[indices]

def main():
    config_line = sys.stdin.readline()
    if not config_line:
        return
    config = json.loads(config_line)

    # 从 init config 读取全量配置作为全局默认值
    beam_size = config.get("beam_size", 5)
    vad_filter = config.get("vad_filter", True)
    vad_min_silence_ms = config.get("vad_min_silence_ms", 500)

    model = WhisperModel(
        config["model"],
        device=config["device"],
        compute_type=config["compute_type"]
    )

    sys.stdout.write(json.dumps({"status": "ready", "pid": config.get("pid", 0)}) + "\\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        request = {}
        try:
            request = json.loads(line)
            if request.get("command") == "shutdown":
                break

            audio_path = request["audio_path"]
            audio_data, sample_rate = sf.read(audio_path)
            if sample_rate != TARGET_SR:
                audio_data = resample_audio(audio_data, sample_rate)

            segments, info = model.transcribe(
                audio_data,
                language=request.get("language", "en"),
                beam_size=request.get("beam_size", beam_size),
                initial_prompt=request.get("initial_prompt"),
                vad_filter=request.get("vad_filter", vad_filter),
                vad_parameters=dict(
                    min_silence_duration_ms=request.get("vad_min_silence_ms", vad_min_silence_ms)
                ),
            )

            result = {
                "id": request.get("id", "unknown"),
                "status": "ok",
                "text": " ".join(seg.text for seg in segments),
                "segments": [
                    {
                        "text": seg.text,
                        "start": seg.start,
                        "end": seg.end,
                        "confidence": getattr(seg, "avg_logprob", 0)
                    }
                    for seg in segments
                ],
                "language": info.language,
                "duration": info.duration,
            }
            sys.stdout.write(json.dumps(result) + "\\n")
            sys.stdout.flush()

        except Exception as e:
            error_result = {
                "id": request.get("id", "unknown"),
                "status": "error",
                "message": str(e),
            }
            sys.stdout.write(json.dumps(error_result) + "\\n")
            sys.stdout.flush()

if __name__ == "__main__":
    main()
`.trim();
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
      const { execSync } = require('child_process');
      execSync(
        `"${this.config.pythonCmd}" -c "import faster_whisper; print(faster_whisper.__version__)"`,
        { stdio: 'pipe', timeout: 5000 }
      );
      this._cachedAvailable = true;
      this._lastProbeAt = Date.now();
      return true;
    } catch {
      this._cachedAvailable = false;
      this._lastProbeAt = Date.now();
      return false;
    }
  }

  /**
   * 文件级转录
   * 将音频写入临时文件，通过长驻进程转录，解析 JSON 结果
   *
   * @param audioData 音频数据（WAV/PCM）
   * @param options 转录选项
   */
  async transcribe(
    audioData: Buffer,
    options?: STTTranscribeOptions
  ): Promise<STTResult> {
    const audioPath = join(tmpdir(), `stt_${randomUUID()}.wav`);
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

          // 写入音频临时文件
          writeFileSync(audioPath, audioData);

          // 确保长驻进程已启动并就绪
          await this.ensureWorker();

          // 发送转录请求并等待结果
          const resultJson = await this.sendRequest(
            audioPath,
            language,
            options
          );
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
        } finally {
          try {
            unlinkSync(audioPath);
          } catch {
            // 临时文件清理失败不影响主流程
          }
        }
      }
    );
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
      pid: process.pid,
    });

    const proc = spawn(this.config.pythonCmd!, [this._workerScriptPath!], {
      stdio: ['pipe', 'pipe', 'pipe'],
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
              logger.error('重启工作进程失败', { error: String(err) });
            });
          }
        }, RESTART_DELAY_MS);
      }
    });

    proc.on('error', (err) => {
      logger.error('Whisper 工作进程错误', { error: err.message });
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
    } catch {
      // 写入失败，直接 kill
    }

    // 3 秒优雅退出超时，超时后强制终止
    const killTimeout = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
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
   * 发送转录请求到工作进程并等待结果
   *
   * @param audioPath 音频文件路径
   * @param language 语言代码
   * @returns 转录结果 JSON 字符串（response 对象序列化）
   */
  private sendRequest(
    audioPath: string,
    language: string,
    options?: STTTranscribeOptions
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
      if (options?.keyterms?.length) {
        initialPrompt = options.keyterms.join(', ');
      }

      try {
        // 请求消息只携带 per-request 数据，全局配置已打包在 init config 中
        const request = JSON.stringify({
          id: reqId,
          audio_path: audioPath,
          language,
          initial_prompt: initialPrompt,
        });

        this._workerProcess?.stdin?.write(request + '\n');
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
      } catch {
        // 清理失败不影响主流程
      }
      this._workerScriptPath = null;
    }
  }
}

// ===== 验证函数 =====

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
