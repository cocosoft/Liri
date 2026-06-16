/**
 * LocalSTTProvider
 * 本地 STT 提供者
 * 通过 spawn Python faster-whisper 进程实现本地语音转文字
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

import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { writeFileSync, unlinkSync } from 'fs';
import { Logger } from '@modules/monitoring/logs/Logger';
import { handleError } from '@modules/error/handleError';
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

/** faster-whisper 转录脚本模板 */
const TRANSCRIBE_SCRIPT = `
import sys
import json
from faster_whisper import WhisperModel

model = WhisperModel("{model}", device="{device}", compute_type="{compute_type}")
segments, info = model.transcribe(
    "{audio_path}",
    language="{language}",
    beam_size={beam_size},
    vad_filter={vad_filter},
    vad_parameters=dict(min_silence_duration_ms={vad_min_silence}),
)
result = {{
    "text": " ".join(seg.text for seg in segments),
    "segments": [
        {{
            "text": seg.text,
            "start": seg.start,
            "end": seg.end,
            "confidence": seg.avg_logprob if hasattr(seg, 'avg_logprob') else 0
        }}
        for seg in segments
    ],
    "language": info.language,
    "duration": info.duration,
}}
print(json.dumps(result))
`;

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
 * 本地 STT 提供者
 * 通过 spawn Python faster-whisper 进程实现语音转文字
 */
export class LocalSTTProvider implements STTProvider {
  readonly id = PROVIDER_ID;
  readonly name = PROVIDER_NAME;
  readonly type: STTProviderType = 'local';
  readonly supportsStreaming = false;
  readonly supportsKeyterms = false;

  private config: LocalSTTConfig;

  constructor(config: LocalSTTConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<LocalSTTConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 检查提供者是否可用
   * 通过检测 Python 环境和 faster-whisper 模块来判断
   */
  isAvailable(): boolean {
    try {
      const { execSync } = require('child_process');
      execSync(
        `"${this.config.pythonCmd}" -c "import faster_whisper; print(faster_whisper.__version__)"`,
        { stdio: 'pipe', timeout: 5000 }
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 文件级转录
   * 将音频写入临时文件，调用 faster-whisper 转录，解析 JSON 结果
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

    try {
      writeFileSync(audioPath, audioData);

      const script = TRANSCRIBE_SCRIPT.replace('{model}', model)
        .replace('{device}', this.config.device!)
        .replace('{compute_type}', this.config.computeType!)
        .replace('{audio_path}', audioPath.replace(/\\/g, '\\\\'))
        .replace('{language}', language)
        .replace('{beam_size}', String(this.config.beamSize!))
        .replace('{vad_filter}', String(this.config.vadFilter!))
        .replace('{vad_min_silence}', String(this.config.vadMinSilenceMs!));

      const result = await this.runPythonScript(script);

      const parsed = JSON.parse(result);

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
      const errorMsg = error instanceof Error ? error.message : String(error);
      void handleError(error, { module: 'services:voice:localSTT', action: 'transcribe' });

      return {
        text: '',
        confidence: 0,
        isFinal: true,
        duration: 0,
        language,
        provider: PROVIDER_ID,
      };
    } finally {
      try {
        unlinkSync(audioPath);
      } catch {
        // 临时文件清理失败不影响主流程
      }
    }
  }

  /**
   * 运行 Python 脚本并获取输出
   * 使用 spawn 而非 execSync 以避免缓冲区溢出
   */
  private runPythonScript(script: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const errorChunks: Buffer[] = [];

      const proc = spawn(this.config.pythonCmd!, ['-c', script], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120000,
      });

      proc.stdout.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        errorChunks.push(chunk);
      });

      proc.on('error', (err) => {
        reject(new Error(`启动 Python 进程失败: ${err.message}`));
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          const stderr = Buffer.concat(errorChunks).toString().trim();
          reject(
            new Error(`Python 进程退出码 ${code}: ${stderr || '未知错误'}`)
          );
          return;
        }

        resolve(Buffer.concat(chunks).toString().trim());
      });
    });
  }

  /**
   * LocalSTTProvider 不支持流式转录
   */
  createStream(_options?: STTStreamOptions): STTStreamConnection {
    throw new Error('LocalSTTProvider 不支持流式转录');
  }
}
