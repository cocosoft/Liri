/**
 * OpenAITTSProvider
 * OpenAI TTS 提供者
 * 通过 OpenAI TTS API 合成语音，支持多种语音和格式
 */

import { request as httpRequest, RequestOptions } from 'http';
import { request as httpsRequest } from 'https';
import { createWriteStream, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Logger, LogLevel, getOTelTracing } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type {
  TTSProvider,
  TTSVoice,
  TTSSpeakOptions,
  TTSSpeakResult,
} from './ttsProvider';

const logger = new Logger({ module: 'voice:openaiTTS', level: LogLevel.INFO });

/** OpenAI TTS API 端点 */
const OPENAI_TTS_ENDPOINT = 'api.openai.com';
const OPENAI_TTS_PATH = '/v1/audio/speech';

/** OpenAI 支持的语音列表 */
const OPENAI_VOICES: TTSVoice[] = [
  { id: 'alloy', name: 'Alloy', language: 'en-US', gender: 'male' },
  { id: 'echo', name: 'Echo', language: 'en-US', gender: 'male' },
  { id: 'fable', name: 'Fable', language: 'en-GB', gender: 'female' },
  { id: 'onyx', name: 'Onyx', language: 'en-US', gender: 'male' },
  { id: 'nova', name: 'Nova', language: 'en-US', gender: 'female' },
  { id: 'shimmer', name: 'Shimmer', language: 'en-US', gender: 'female' },
];

/** 可用模型 */
type OpenAITTSModel = 'tts-1' | 'tts-1-hd';

/** 可用音频格式 */
type OpenAIResponseFormat = 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';

/** OpenAI TTS 提供者配置 */
export interface OpenAITTSConfig {
  apiKey: string;
  model?: OpenAITTSModel;
  format?: OpenAIResponseFormat;
  baseUrl?: string;
}

/**
 * OpenAI TTS 提供者
 * 通过 OpenAI TTS API 合成高质量神经网络语音
 */
export class OpenAITTSProvider implements TTSProvider {
  readonly name = 'openai';
  readonly supportedFormats = ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'];

  private config: OpenAITTSConfig;
  private abortController: AbortController | null = null;

  constructor(config: OpenAITTSConfig) {
    this.config = {
      model: 'tts-1',
      format: 'mp3',
      ...config,
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<OpenAITTSConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取支持的语音列表
   */
  getVoices(): TTSVoice[] {
    return OPENAI_VOICES;
  }

  /**
   * 合成语音
   */
  async speak(options: TTSSpeakOptions): Promise<TTSSpeakResult> {
    const voiceId = options.voice || 'alloy';
    const voice = OPENAI_VOICES.find((v) => v.id === voiceId);

    if (!options.text) {
      return { success: false, error: '合成文本不能为空' };
    }

    const format = options.format ?? this.config.format;

    const body = {
      model: this.config.model,
      input: options.text,
      voice: voiceId,
      response_format: format,
      speed: options.speed ?? 1.0,
    };

    const otel = getOTelTracing();
    return otel.wrap(
      {
        name: 'voice.openai.tts.speak',
        attributes: { voice: voiceId, textLength: options.text.length },
      },
      async () => {
        try {
          const audioBuffer = await this.makeRequest(body);

          const durationEstimate = this.estimateDuration(
            options.text,
            options.speed
          );

          logger.info('OpenAI TTS 合成成功', {
            voice: voiceId,
            textLength: options.text.length,
            durationEstimate,
          });

          return {
            success: true,
            audioDurationSec: durationEstimate,
            voice,
            audioData: audioBuffer,
            audioFormat: format,
          };
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          void handleError(error, {
            module: 'services:voice:openaiTTS',
            action: 'speak',
            context: { voice: options.voice, textLength: options.text.length },
          });
          return {
            success: false,
            error: `OpenAI TTS 合成失败: ${errorMsg}`,
          };
        }
      }
    )();
  }

  /**
   * 合成并保存到文件
   */
  async save(
    options: TTSSpeakOptions & { filename: string }
  ): Promise<TTSSpeakResult> {
    const voiceId = options.voice || 'alloy';
    const voice = OPENAI_VOICES.find((v) => v.id === voiceId);

    const format = options.format ?? this.config.format;

    const body = {
      model: this.config.model,
      input: options.text,
      voice: voiceId,
      response_format: format,
      speed: options.speed ?? 1.0,
    };

    try {
      const audioBuffer = await this.makeRequest(body);

      const fs = await import('fs');
      fs.writeFileSync(options.filename, audioBuffer);

      const durationEstimate = this.estimateDuration(
        options.text,
        options.speed
      );

      logger.info('OpenAI TTS 保存成功', {
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
      void handleError(error, {
        module: 'services:voice:openaiTTS',
        action: 'save',
        context: { voice: options.voice, filePath: options.filename },
      });
      return {
        success: false,
        error: `OpenAI TTS 保存失败: ${errorMsg}`,
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
   * 发起 HTTPS 请求到 OpenAI TTS API
   */
  private makeRequest(body: Record<string, unknown>): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      this.abortController = new AbortController();

      const bodyStr = JSON.stringify(body);
      const options: RequestOptions = {
        hostname: this.config.baseUrl || OPENAI_TTS_ENDPOINT,
        path: OPENAI_TTS_PATH,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
        signal: this.abortController.signal,
      };

      const req = httpsRequest(options, (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        res.on('end', () => {
          const buffer = Buffer.concat(chunks);

          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(buffer);
          } else {
            const errorText = buffer.toString('utf8');
            reject(new Error(`API 返回状态码 ${res.statusCode}: ${errorText}`));
          }
        });
      });

      req.on('error', (error) => {
        if (error.name === 'AbortError') {
          reject(new Error('请求已取消'));
        } else {
          reject(error);
        }
      });

      req.write(bodyStr);
      req.end();
    });
  }

  /**
   * 估计音频时长（基于文本长度和经验系数）
   */
  private estimateDuration(text: string, speed?: number): number {
    const baseSpeed = speed ?? 1.0;
    const charsPerSecond = 15 * baseSpeed;
    return Math.max(1, Math.round(text.length / charsPerSecond));
  }
}
