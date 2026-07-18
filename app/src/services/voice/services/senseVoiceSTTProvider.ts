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
 * - SenseVoiceSmall 模型（自动下载到 models 目录）
 *
 * 用法：
 * ```ts
 * import { SenseVoiceSTTProvider } from './senseVoiceSTTProvider';
 * STTRegistry.register(new SenseVoiceSTTProvider());
 * ```
 */

import { spawn, ChildProcess, execSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
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

/**
 * 构建 SenseVoice 长驻 Python 工作进程脚本
 *
 * 使用 sherpa-onnx OfflineRecognizer 进行语音识别。
 * 启动时加载 SenseVoiceSmall 模型，通过 stdin/stdout JSON-line 协议通信。
 *
 * 输入（stdin 每行一个 JSON）：
 *   首行（整包配置）: {"model":"SenseVoiceSmall","device":"cpu","download_root":"..."}
 *   请求（per-request）: {"id":"req-1","audio_path":"/tmp/1.wav","language":"zh"}
 *   关闭: {"command":"shutdown"}
 *
 * 输出（stdout 每行一个 JSON）：
 *   就绪: {"status":"ready"}
 *   成功: {"id":"req-1","status":"ok","text":"...","segments":[...],"language":"zh","duration":2.5}
 *   失败: {"id":"req-1","status":"error","message":"..."}
 */
function buildSenseVoiceWorkerScript(): string {
  return `
import sys, json, os, warnings
warnings.filterwarnings("ignore")

import numpy as np
import soundfile as sf

TARGET_SR = 16000

def resample_audio(audio_data, sample_rate):
    """重采样到 16kHz（SenseVoice 要求）"""
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

def build_recognizer(model_name, device, download_root):
    """构建 sherpa-onnx OfflineRecognizer"""
    from sherpa_onnx import (
        OfflineRecognizer,
        OfflineRecognizerConfig,
        OfflineModelConfig,
        OfflineSenseVoiceModelConfig,
    )

    model_dir = os.path.join(download_root, "sherpa-onnx", model_name)
    os.makedirs(model_dir, exist_ok=True)

    sense_voice_config = OfflineSenseVoiceModelConfig(
        model=os.path.join(model_dir, "model.onnx"),
        use_itn=True,
    )

    model_config = OfflineModelConfig(
        sense_voice=sense_voice_config,
        debug=False,
        provider="cpu" if device == "cpu" else "cuda",
    )

    config = OfflineRecognizerConfig(
        model=model_config,
    )

    return OfflineRecognizer(config)

def main():
    config_line = sys.stdin.readline()
    if not config_line:
        return
    config = json.loads(config_line)

    model_name = config.get("model", "SenseVoiceSmall")
    device = config.get("device", "cpu")
    download_root = config.get("download_root", os.path.expanduser("~/.pyapp/models"))

    try:
        recognizer = build_recognizer(model_name, device, download_root)
    except Exception as e:
        # 模型未下载时给出友好提示
        error_msg = str(e)
        if "model.onnx" in error_msg or "No such file" in error_msg:
            error_msg = (
                f"SenseVoice 模型未找到。请确保模型已下载到: "
                f"{download_root}/sherpa-onnx/{model_name}/model.onnx\\n"
                f"可从 HuggingFace 下载: "
                f"https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"
            )
        sys.stdout.write(json.dumps({"status": "error", "message": error_msg}) + "\\n")
        sys.stdout.flush()
        return

    sys.stdout.write(json.dumps({"status": "ready"}) + "\\n")
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

            # 多声道转单声道
            if audio_data.ndim > 1:
                audio_data = audio_data.mean(axis=1)

            if sample_rate != TARGET_SR:
                audio_data = resample_audio(audio_data, sample_rate)

            # 转为 float32（sherpa-onnx 要求）
            audio_data = audio_data.astype(np.float32)

            # 创建流式识别
            stream = recognizer.create_stream()
            stream.accept_waveform(TARGET_SR, audio_data)
            recognizer.decode_stream(stream)

            result_text = stream.result.text
            segments = []

            # SenseVoice 支持时间戳时有 tokens 信息
            if hasattr(stream.result, "tokens") and stream.result.tokens:
                start_time = 0.0
                for token in stream.result.tokens:
                    segments.append({
                        "text": token,
                        "start": start_time,
                        "end": start_time + 0.3,
                        "confidence": 0.9,
                    })
                    start_time += 0.3

            duration = len(audio_data) / TARGET_SR

            result = {
                "id": request.get("id", "unknown"),
                "status": "ok",
                "text": result_text.strip(),
                "segments": segments,
                "language": request.get("language", "zh"),
                "duration": duration,
            }
            sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\\n")
            sys.stdout.flush()

        except Exception as e:
            import traceback
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
      execSync(
        `"${this.config.pythonCmd}" -c "import sherpa_onnx; print('ok')"`,
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
              logger.error('重启 SenseVoice 工作进程失败', {
                error: String(err),
              });
            });
          }
        }, RESTART_DELAY_MS);
      }
    });

    proc.on('error', (err) => {
      logger.error('SenseVoice 工作进程错误', { error: err.message });
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
