/**
 * PiperTTSProvider
 * Piper 本地离线 TTS 提供者
 *
 * 基于 PiperTTS 的本地神经网络语音合成（ONNX 运行时）。
 * Piper 是一个快速、本地运行的 TTS 引擎，支持多种语言和语音。
 * 项目地址：https://github.com/rhasspy/piper
 *
 * 使用方法：
 *   1. 下载 piper 二进制文件并添加到 PATH
 *   2. 下载 .onnx 模型文件
 *   3. 创建 provider 时指定模型路径
 *
 * 示例：
 * ```ts
 * const provider = new PiperTTSProvider({
 *   modelPath: 'models/zh_CN-hf_female.onnx',
 * });
 * ```
 */

import { spawn, execSync } from 'child_process';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { randomUUID } from 'crypto';
import { existsSync, unlinkSync, readFileSync } from 'fs';
import { Logger, LogLevel, getOTelTracing } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type {
  TTSProvider,
  TTSVoice,
  TTSSpeakOptions,
  TTSSpeakResult,
} from './ttsProvider';

const logger = new Logger({ level: LogLevel.INFO });

/** Piper 模型索引条目（方案 19） */
export interface ModelIndexEntry {
  id: string;
  name: string;
  language: string;
  gender: string;
  fileSize: number;
  sampleRate: number;
  filePath: string;
}

/** 内置知名 Piper 模型语音定义 */
const PIPER_VOICES: TTSVoice[] = [
  {
    id: 'zh_CN-hf_female',
    name: '中文女声',
    language: 'zh-CN',
    gender: 'female',
  },
  { id: 'zh_CN-hf_male', name: '中文男声', language: 'zh-CN', gender: 'male' },
  {
    id: 'en_US-lessac-medium',
    name: '英文女声 (Lessac)',
    language: 'en-US',
    gender: 'female',
  },
  {
    id: 'en_US-amy-medium',
    name: '英文女声 (Amy)',
    language: 'en-US',
    gender: 'female',
  },
  {
    id: 'en_US-norman-medium',
    name: '英文男声 (Norman)',
    language: 'en-US',
    gender: 'male',
  },
  {
    id: 'en_US-kathleen-medium',
    name: '英文女声 (Kathleen)',
    language: 'en-US',
    gender: 'female',
  },
  {
    id: 'en_US-ryan-medium',
    name: '英文男声 (Ryan)',
    language: 'en-US',
    gender: 'male',
  },
  {
    id: 'en_GB-alan-medium',
    name: '英式男声 (Alan)',
    language: 'en-GB',
    gender: 'male',
  },
  {
    id: 'en_GB-sarah-medium',
    name: '英式女声 (Sarah)',
    language: 'en-GB',
    gender: 'female',
  },
  {
    id: 'ja_JP-hf_female',
    name: '日语女声',
    language: 'ja-JP',
    gender: 'female',
  },
  {
    id: 'ko_KR-hf_female',
    name: '韩语女声',
    language: 'ko-KR',
    gender: 'female',
  },
  {
    id: 'fr_FR-hf_female',
    name: '法语女声',
    language: 'fr-FR',
    gender: 'female',
  },
  {
    id: 'de_DE-hf_female',
    name: '德语女声',
    language: 'de-DE',
    gender: 'female',
  },
  {
    id: 'ru_RU-hf_female',
    name: '俄语女声',
    language: 'ru-RU',
    gender: 'female',
  },
  {
    id: 'es_ES-hf_female',
    name: '西班牙语女声',
    language: 'es-ES',
    gender: 'female',
  },
];

/** Piper TTS 提供者配置 */
export interface PiperTTSConfig {
  /** piper 二进制路径（默认从 PATH 查找） */
  binaryPath?: string;
  /** 模型文件所在目录 */
  modelDir: string;
  /** 默认使用的语音 ID */
  defaultVoice?: string;
  /** 默认语速（1.0 为正常） */
  defaultSpeed?: number;
  /** 合成超时时间（毫秒），默认 30000 */
  timeoutMs?: number;
}

/** 命令检测缓存 */
let piperAvailableCache: boolean | null = null;

/**
 * 检查 piper 二进制是否可用
 */
function isPiperAvailable(binaryPath?: string): boolean {
  if (piperAvailableCache !== null && !binaryPath) {
    return piperAvailableCache;
  }

  try {
    const cmd = binaryPath || 'piper';
    execSync(`"${cmd}" --help 2>nul || ${cmd} --help 2>/dev/null`, {
      stdio: 'ignore',
      timeout: 5000,
    });
    piperAvailableCache = true;
    return true;
  } catch {
    piperAvailableCache = false;
    return false;
  }
}

/**
 * 重置命令检测缓存（主要用于测试）
 */
export function resetPiperCache(): void {
  piperAvailableCache = null;
}

/**
 * 获取系统播放命令
 */
function getPlayCommand(): string {
  const platform = process.platform;
  if (platform === 'win32') {
    return 'start';
  }
  if (platform === 'darwin') {
    return 'afplay';
  }
  return 'aplay';
}

/**
 * 使用系统命令播放 WAV 文件
 */
function playWavFile(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = process.platform;
    let cmd: string;
    let args: string[];

    if (platform === 'win32') {
      // Windows 使用 PowerShell SoundPlayer 播放 WAV
      cmd = 'powershell';
      args = [
        '-c',
        `(New-Object Media.SoundPlayer '${filePath.replace(/'/g, "''")}').PlaySync()`,
      ];
    } else if (platform === 'darwin') {
      cmd = 'afplay';
      args = [filePath];
    } else {
      cmd = 'aplay';
      args = [filePath];
    }

    const proc = spawn(cmd, args, { stdio: 'ignore' });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`播放命令退出码: ${code}`));
      }
    });
    proc.on('error', reject);
  });
}

/**
 * Piper 本地离线 TTS 提供者
 *
 * 使用本地 PiperTTS 引擎合成语音，无需网络连接。
 * 需要预先下载 .onnx 模型文件。
 */
export class PiperTTSProvider implements TTSProvider {
  readonly name = 'piper';
  readonly supportedFormats = ['wav'];

  private config: Required<PiperTTSConfig>;
  private voices: TTSVoice[];
  private abortController: AbortController | null = null;

  constructor(config: PiperTTSConfig) {
    this.config = {
      binaryPath: config.binaryPath || 'piper',
      modelDir: resolve(config.modelDir),
      defaultVoice: config.defaultVoice || 'en_US-lessac-medium',
      defaultSpeed: config.defaultSpeed ?? 1.0,
      timeoutMs: config.timeoutMs ?? 30000,
    };

    this.voices = this.scanVoices();
  }

  /**
   * 扫描模型目录获取可用语音列表
   * 查找所有 .onnx 文件并与内置语音定义匹配
   */
  private scanVoices(): TTSVoice[] {
    const dir = this.config.modelDir;
    if (!existsSync(dir)) {
      logger.warn('Piper 模型目录不存在', { path: dir });
      return [];
    }

    const fs = require('fs');
    const files: string[] = [];
    try {
      fs.readdirSync(dir).forEach((file: string) => {
        if (file.endsWith('.onnx')) {
          files.push(file.replace(/\.onnx$/, ''));
        }
      });
    } catch (error) {
      void handleError(error, {
        module: 'services:voice:piper',
        action: 'scan_voices',
        context: { modelDir: dir },
      });
      return [];
    }

    if (files.length === 0) {
      logger.warn('模型目录中未找到 .onnx 文件', { path: dir });
      return [];
    }

    // 匹配内置语音定义，未匹配的按文件名构建基本信息
    const matched: TTSVoice[] = [];
    for (const file of files) {
      const builtin = PIPER_VOICES.find((v) => v.id === file);
      if (builtin) {
        matched.push(builtin);
      } else {
        matched.push({
          id: file,
          name: file,
          language: 'unknown',
          gender: 'female',
        });
      }
    }

    return matched;
  }

  /**
   * 检查 Piper 是否可用
   */
  static isAvailable(binaryPath?: string): boolean {
    return isPiperAvailable(binaryPath);
  }

  /**
   * 获取可用模型目录路径
   */
  getModelDir(): string {
    return this.config.modelDir;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<PiperTTSConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.modelDir) {
      this.config.modelDir = resolve(config.modelDir);
      this.voices = this.scanVoices();
    }
  }

  /**
   * 获取可用语音列表
   */
  getVoices(): TTSVoice[] {
    return this.voices;
  }

  /**
   * 合成语音
   */
  async speak(options: TTSSpeakOptions): Promise<TTSSpeakResult> {
    if (!PiperTTSProvider.isAvailable(this.config.binaryPath)) {
      return {
        success: false,
        error: 'Piper 二进制不可用，请确保 piper 已安装并添加到 PATH',
      };
    }

    const voiceId = options.voice || this.config.defaultVoice;
    const voice = this.voices.find((v) => v.id === voiceId);
    const modelFile = join(this.config.modelDir, `${voiceId}.onnx`);

    if (!existsSync(modelFile)) {
      return {
        success: false,
        error: `模型文件不存在: ${modelFile}，请确保已下载对应的 .onnx 模型`,
      };
    }

    const tempFile = join(
      tmpdir(),
      `piper_${randomUUID().replace(/-/g, '').slice(0, 12)}.wav`
    );

    const otel = getOTelTracing();
    return otel.wrap(
      {
        name: 'voice.piper.tts.speak',
        attributes: { voice: voiceId, textLength: options.text.length },
      },
      async () => {
        try {
          await this.runPiper(options.text, modelFile, tempFile, options.speed);

          await playWavFile(tempFile);

          const durationEstimate = this.estimateDuration(
            options.text,
            options.speed
          );

          logger.info('Piper TTS 播放成功', {
            voice: voiceId,
            textLength: options.text.length,
            durationEstimate,
          });

          return {
            success: true,
            audioDurationSec: durationEstimate,
            voice,
          };
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          logger.error('Piper TTS 播放失败', { error: errorMsg });
          void handleError(error, {
            module: 'services:voice:piperTTS',
            action: 'speak',
          });
          return {
            success: false,
            error: `Piper TTS 播放失败: ${errorMsg}`,
          };
        } finally {
          try {
            if (existsSync(tempFile)) unlinkSync(tempFile);
          } catch {
            // 忽略临时文件清理错误
          }
        }
      }
    )();
  }

  /**
   * preloadDefaultModel — 预加载默认模型（方案 14）
   *
   * 在后台预热默认语音模型（合成极短文本并丢弃输出），
   * 使后续首次合成不必等待模型加载时间。
   * 在应用启动或 Provider 初始化时调用一次即可。
   */
  async preloadDefaultModel(): Promise<void> {
    const modelFile = join(
      this.config.modelDir,
      `${this.config.defaultVoice}.onnx`
    );
    if (!existsSync(modelFile)) {
      logger.warn('PiperTTS · 预加载失败：模型文件不存在', {
        model: this.config.defaultVoice,
        path: modelFile,
      });
      return;
    }

    const tempFile = join(
      tmpdir(),
      `piper_preload_${randomUUID().replace(/-/g, '').slice(0, 8)}.wav`
    );

    try {
      logger.info('PiperTTS · 开始预加载模型', {
        model: this.config.defaultVoice,
      });

      // 合成极短文本以触发模型加载
      await this.runPiper(' ', modelFile, tempFile, 1.0);

      logger.info('PiperTTS · 模型预加载完成', {
        model: this.config.defaultVoice,
      });
    } catch (error) {
      logger.warn('PiperTTS · 模型预加载失败（不影响后续使用）', {
        model: this.config.defaultVoice,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      try {
        if (existsSync(tempFile)) unlinkSync(tempFile);
      } catch {
        // 忽略
      }
    }
  }

  /**
   * keepAlive — 保持模型常驻（方案 14）
   *
   * 定期执行空合成以保持模型在内存中，避免因空闲被系统换出。
   * 调用者需管理定时器，并在 Provider 销毁时清除。
   *
   * @returns 一个清除函数，调用后停止 keepAlive
   */
  keepAlive(intervalMs: number = 60000): () => void {
    const timer = setInterval(async () => {
      await this.preloadDefaultModel();
    }, intervalMs);

    return () => {
      clearInterval(timer);
    };
  }

  /**
   * 合成并保存到音频文件
   */
  async save(
    options: TTSSpeakOptions & { filename: string }
  ): Promise<TTSSpeakResult> {
    if (!PiperTTSProvider.isAvailable(this.config.binaryPath)) {
      return {
        success: false,
        error: 'Piper 二进制不可用',
      };
    }

    const voiceId = options.voice || this.config.defaultVoice;
    const voice = this.voices.find((v) => v.id === voiceId);
    const modelFile = join(this.config.modelDir, `${voiceId}.onnx`);

    if (!existsSync(modelFile)) {
      return {
        success: false,
        error: `模型文件不存在: ${modelFile}`,
      };
    }

    try {
      await this.runPiper(
        options.text,
        modelFile,
        options.filename,
        options.speed
      );

      const durationEstimate = this.estimateDuration(
        options.text,
        options.speed
      );

      logger.info('Piper TTS 保存成功', {
        voice: voiceId,
        filePath: options.filename,
        durationEstimate,
      });

      return {
        success: true,
        audioDurationSec: durationEstimate,
        filePath: options.filename,
        voice,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Piper TTS 保存失败', { error: errorMsg });
      return {
        success: false,
        error: `Piper TTS 保存失败: ${errorMsg}`,
      };
    }
  }

  /**
   * 停止合成
   */
  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * buildModelIndex — 扫描模型目录构建索引（方案 19）
   *
   * 扫描模型目录下所有 .onnx 文件，与内置语音定义匹配后返回索引列表。
   * 可用于 UI 展示可用模型列表、文件大小等信息。
   *
   * @returns 模型索引条目列表
   */
  buildModelIndex(): ModelIndexEntry[] {
    const dir = this.config.modelDir;
    if (!existsSync(dir)) {
      logger.warn('PiperTTS · 模型目录不存在，无法构建索引', { path: dir });
      return [];
    }

    const fs = require('fs');
    const entries: ModelIndexEntry[] = [];

    try {
      const files: string[] = fs.readdirSync(dir);
      for (const file of files) {
        if (!file.endsWith('.onnx')) continue;

        const modelId = file.replace('.onnx', '');
        const known = PIPER_VOICES.find((v) => v.id === modelId);
        const stat = require('fs').statSync(require('path').join(dir, file));

        entries.push({
          id: modelId,
          name: known?.name || modelId,
          language: known?.language || 'unknown',
          gender: known?.gender || 'unknown',
          fileSize: stat.size,
          sampleRate: 22050,
          filePath: require('path').join(dir, file),
        });
      }
    } catch (error) {
      logger.error('PiperTTS · 构建模型索引失败', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }

    return entries;
  }

  /**
   * 执行 Piper 合成
   */
  private runPiper(
    text: string,
    modelFile: string,
    outputFile: string,
    speed?: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.abortController = new AbortController();
      const { signal } = this.abortController;

      const lengthScale = speed ? 1.0 / speed : 1.0;

      const piper = spawn(
        this.config.binaryPath,
        [
          '--model',
          modelFile,
          '--output',
          outputFile,
          '--length-scale',
          String(lengthScale.toFixed(2)),
        ],
        {
          stdio: ['pipe', 'ignore', 'pipe'],
          signal,
          timeout: this.config.timeoutMs,
        }
      );

      const stderrChunks: Buffer[] = [];
      piper.stderr!.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      piper.on('error', (err) => {
        if (err.name === 'AbortError') {
          reject(new Error('合成已取消'));
        } else {
          reject(new Error(`启动 Piper 失败: ${err.message}`));
        }
      });

      piper.on('close', (code) => {
        if (code === 0) {
          if (existsSync(outputFile)) {
            resolve();
          } else {
            const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
            reject(new Error(stderr || 'Piper 未生成输出文件'));
          }
        } else {
          const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
          reject(new Error(`Piper 退出码 ${code}: ${stderr || '未知错误'}`));
        }
      });

      // 写入文本到 stdin
      piper.stdin!.write(text);
      piper.stdin!.end();
    });
  }

  /**
   * 估计音频时长
   */
  private estimateDuration(text: string, speed?: number): number {
    const baseSpeed = speed ?? this.config.defaultSpeed;
    // Piper 中文约 5 字/秒，英文约 10 字/秒，取保守 6 字/秒
    const charsPerSecond = 6 * baseSpeed;
    return Math.max(1, Math.round(text.length / charsPerSecond));
  }
}
