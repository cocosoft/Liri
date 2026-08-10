/**
 * EdgeTTSProvider
 * Edge TTS 提供者
 *
 * 通过 Microsoft Edge 浏览器免费 TTS WebSocket API 合成语音。
 * 无需 API Key。WebSocket 传输层已提取到 edgeTTSTransport.ts。
 *
 * 参考产品: edge-tts Python 库
 */

import { createHash, randomUUID, randomBytes } from 'crypto';
import { writeFileSync } from 'fs';
import { getLogger, getOTelTracing } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type {
  TTSProvider,
  TTSVoice,
  TTSSpeakOptions,
  TTSSpeakResult,
  TTSStream,
} from './ttsTypes';
import {
  WsOpcode,
  sendWsFrame,
  wsConnect,
  startHeartbeat as startWsHeartbeat,
  closeConnection,
  type WsConnection,
} from './edgeTTSTransport';

const logger = getLogger('voice:edgeTTS');

/** Edge TTS WebSocket 端点 */
const EDGE_TTS_HOST = 'speech.platform.bing.com';
const EDGE_TTS_PATH =
  '/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4';

/** Chromium 版本，用于 User-Agent 和 Sec-MS-GEC-Version */
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const CHROMIUM_MAJOR_VERSION = '143';
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;

/** 支持的语音列表 */
const EDGE_VOICES: TTSVoice[] = [
  {
    id: 'zh-CN-XiaoxiaoNeural',
    name: 'Xiaoxiao',
    language: 'zh-CN',
    gender: 'female',
  },
  {
    id: 'zh-CN-XiaoyiNeural',
    name: 'Xiaoyi',
    language: 'zh-CN',
    gender: 'female',
  },
  {
    id: 'zh-CN-YunjianNeural',
    name: 'Yunjian',
    language: 'zh-CN',
    gender: 'male',
  },
  { id: 'zh-CN-YunxiNeural', name: 'Yunxi', language: 'zh-CN', gender: 'male' },
  {
    id: 'zh-CN-YunxiaNeural',
    name: 'Yunxia',
    language: 'zh-CN',
    gender: 'male',
  },
  {
    id: 'zh-CN-YunyangNeural',
    name: 'Yunyang',
    language: 'zh-CN',
    gender: 'male',
  },
  {
    id: 'zh-HK-HiuGaaiNeural',
    name: 'HiuGaai',
    language: 'zh-HK',
    gender: 'female',
  },
  {
    id: 'zh-HK-HiuMaanNeural',
    name: 'HiuMaan',
    language: 'zh-HK',
    gender: 'female',
  },
  {
    id: 'zh-HK-WanLungNeural',
    name: 'WanLung',
    language: 'zh-HK',
    gender: 'male',
  },
  {
    id: 'zh-TW-HsiaoChenNeural',
    name: 'HsiaoChen',
    language: 'zh-TW',
    gender: 'female',
  },
  {
    id: 'zh-TW-YunJheNeural',
    name: 'YunJhe',
    language: 'zh-TW',
    gender: 'male',
  },
  {
    id: 'zh-TW-HsiaoYuNeural',
    name: 'HsiaoYu',
    language: 'zh-TW',
    gender: 'female',
  },
  { id: 'en-US-AriaNeural', name: 'Aria', language: 'en-US', gender: 'female' },
  { id: 'en-US-GuyNeural', name: 'Guy', language: 'en-US', gender: 'male' },
  {
    id: 'en-US-JennyNeural',
    name: 'Jenny',
    language: 'en-US',
    gender: 'female',
  },
  { id: 'en-US-AnaNeural', name: 'Ana', language: 'en-US', gender: 'female' },
  {
    id: 'en-US-MichelleNeural',
    name: 'Michelle',
    language: 'en-US',
    gender: 'female',
  },
  {
    id: 'en-GB-SoniaNeural',
    name: 'Sonia',
    language: 'en-GB',
    gender: 'female',
  },
  { id: 'en-GB-RyanNeural', name: 'Ryan', language: 'en-GB', gender: 'male' },
  {
    id: 'ja-JP-NanamiNeural',
    name: 'Nanami',
    language: 'ja-JP',
    gender: 'female',
  },
  { id: 'ja-JP-KeitaNeural', name: 'Keita', language: 'ja-JP', gender: 'male' },
  {
    id: 'ko-KR-SunHiNeural',
    name: 'SunHi',
    language: 'ko-KR',
    gender: 'female',
  },
  {
    id: 'ko-KR-InJoonNeural',
    name: 'InJoon',
    language: 'ko-KR',
    gender: 'male',
  },
  {
    id: 'fr-FR-DeniseNeural',
    name: 'Denise',
    language: 'fr-FR',
    gender: 'female',
  },
  { id: 'fr-FR-HenriNeural', name: 'Henri', language: 'fr-FR', gender: 'male' },
  {
    id: 'de-DE-KatjaNeural',
    name: 'Katja',
    language: 'de-DE',
    gender: 'female',
  },
  {
    id: 'de-DE-ConradNeural',
    name: 'Conrad',
    language: 'de-DE',
    gender: 'male',
  },
];

/**
 * 生成 Sec-MS-GEC DRM 令牌
 * 基于当前时间（对齐到5分钟）和 TrustedClientToken 的 SHA256 哈希
 */
function generateSecMsGec(): string {
  const WIN_EPOCH = 11_644_473_600;
  let ticks = Math.floor(Date.now() / 1000) + WIN_EPOCH;
  ticks -= ticks % 300;
  ticks *= 10_000_000;

  return createHash('sha256')
    .update(`${ticks}6A5AA1D4EAFF4E9FB37E23D68491D6F4`)
    .digest('hex')
    .toUpperCase();
}

/**
 * 生成 muid Cookie 值（16 字节随机 hex，大写）
 */
function generateMuid(): string {
  return randomBytes(16).toString('hex').toUpperCase();
}

/**
 * 生成 JavaScript 风格日期字符串
 */
function dateToString(): string {
  const d = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const fmt = (n: number) => String(n).padStart(2, '0');
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${fmt(d.getUTCDate())} ${d.getUTCFullYear()} ${fmt(d.getUTCHours())}:${fmt(d.getUTCMinutes())}:${fmt(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`;
}

/**
 * 从 Edge TTS 二进制帧中提取纯音频数据
 *
 * Edge TTS 的二进制帧格式如下：
 *   [2字节 header_length (Big Endian)][header 文本][\r\n][音频数据]
 *
 * 参考 Python edge-tts 库的 ChunkDecoder。
 *
 * @param data 二进制帧负载
 * @returns 纯音频数据，如果格式不正确则返回 null
 */
/**
 * 从 Edge TTS 二进制帧中提取纯音频数据
 *
 * Edge TTS 二进制帧格式（已通过实际抓包验证）：
 *   [2字节 headerLength Big Endian][header 文本 (\r\n 分隔)][\r\n][MP3 音频数据]
 *
 * 其中 headerLength 包含前2字节自身。
 * 示例（音频帧）：
 *   bytes[0:2] = headerLength = 128
 *   bytes[0:128] = header 文本（含 Path:audio）
 *   bytes[128:130] = \r\n 分隔
 *   bytes[130:] = MP3 音频数据（以 0xFF 0xF3 开头）
 *
 * 参考 Python edge-tts 库的 get_headers_and_data 函数。
 *
 * @param data 二进制帧负载
 * @returns 纯音频数据，如果不是音频帧则返回 null
 */
function extractAudioFromBinaryFrame(data: Buffer): Buffer | null {
  if (data.length < 4) return null;

  const headerLength = data.readUInt16BE(0);

  // 验证 headerLength 的合理性（必须包含长度字段自身 + 至少 \r\n 分隔）
  if (
    headerLength > 2 &&
    headerLength < data.length &&
    headerLength + 2 <= data.length
  ) {
    // headerLength 包含前2字节自身：data[0:headerLength] 为完整 header 文本
    // data[headerLength:headerLength+2] 为 \r\n 分隔
    // data[headerLength+2:] 为 MP3 音频数据
    const headerText = data.slice(0, headerLength);
    if (headerText.includes('Path:audio')) {
      return data.slice(headerLength + 2);
    }
    // turn.start/end 等非音频帧，跳过
    return null;
  }

  // 裸 MP3 流（无 header，极少数情况）
  if (data[0] === 0xff && (data[1] & 0xe0) === 0xe0) {
    return data;
  }

  return null;
}

/**
 * 生成合成上下文 SSML
 */
function buildSsml(
  text: string,
  voice: string,
  rate: string = '+0%',
  pitch: string = '+0Hz',
  volume: string = '+0%'
): string {
  return [
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>",
    `<voice name='${voice}'>`,
    `<prosody rate='${rate}' pitch='${pitch}' volume='${volume}'>`,
    escapeXml(text),
    '</prosody>',
    '</voice>',
    '</speak>',
  ].join('');
}

/**
 * XML 转义
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 构建 synthesis context（含请求头）
 * 格式与 edge-tts Python 库一致
 */
function buildContext(voice: string): string {
  const timestamp = dateToString();
  const payload = JSON.stringify({
    context: {
      synthesis: {
        audio: {
          metadataoptions: {
            sentenceBoundaryEnabled: false,
            wordBoundaryEnabled: false,
          },
          outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
        },
      },
    },
  });
  return [
    `X-Timestamp:${timestamp}`,
    'Content-Type:application/json; charset=utf-8',
    'Path:speech.config',
    '',
    '',
    payload,
  ].join('\r\n');
}

/**
 * 构建 SSML 文本帧（含请求头）
 * 格式与 edge-tts Python 库一致
 */
function buildSsmlPayload(
  text: string,
  voice: string,
  rate: string = '+0%',
  pitch: string = '+0Hz',
  volume: string = '+0%'
): string {
  const requestId = randomUUID();
  const timestamp = dateToString();
  const ssml = buildSsml(text, voice, rate, pitch, volume);
  return [
    `X-RequestId:${requestId}`,
    'Content-Type:application/ssml+xml',
    `X-Timestamp:${timestamp}Z`, // 尾随 Z 是微软 Edge 的 bug，必须保留以匹配
    'Path:ssml',
    '',
    '',
    ssml,
  ].join('\r\n');
}

/** Edge TTS 配置 */
export interface EdgeTTSConfig {
  voice?: string;
  rate?: string;
  pitch?: string;
  proxy?: string;
}

/**
 * EdgeTTSProvider
 * 通过 Microsoft Edge 免费 TTS API 合成语音
 */
export class EdgeTTSProvider implements TTSProvider {
  readonly name = 'edge';
  readonly supportedFormats = ['mp3'];
  private config: EdgeTTSConfig;
  private wsConnection: WsConnection | null = null;
  /** 心跳定时器 */
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  /** 历史响应延迟记录（最后 100 次），用于自适应超时 */
  private responseLatencies: number[] = [];
  private readonly MAX_LATENCIES = 100;

  /**
   * 空闲连接池（3.8/P1-3 连接复用）
   * voice → 最近一次空闲连接：合成完成后不关闭，`turn.end` 区分轮次，
   * 下次同 voice 合成直接复用（免握手）。每个 voice 至多保留 1 个空闲连接。
   */
  private idlePool = new Map<
    string,
    {
      conn: WsConnection;
      ping: ReturnType<typeof setInterval> | null;
    }
  >();

  constructor(config?: EdgeTTSConfig) {
    this.config = {
      voice: 'zh-CN-XiaoxiaoNeural',
      rate: '+0%',
      pitch: '+0Hz',
      ...config,
    };
  }

  /**
   * 计算自适应超时
   * 基于历史 P99 延迟 × 3，默认 20s，上限 60s
   */
  private calculateTimeout(): number {
    if (this.responseLatencies.length < 10) return 20_000; // 默认 20s
    const sorted = [...this.responseLatencies].sort((a, b) => a - b);
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    return Math.min(Math.max(p99 * 3, 10_000), 60_000); // P99 × 3, 下限 10s, 上限 60s
  }

  /**
   * 记录响应延迟
   */
  private recordLatency(ms: number): void {
    this.responseLatencies.push(ms);
    if (this.responseLatencies.length > this.MAX_LATENCIES) {
      this.responseLatencies.shift();
    }
  }

  /**
   * 启动 WebSocket 心跳保活（每 15s 发送 PING）
   * 委托给 edgeTTSTransport.startHeartbeat
   */
  private startHeartbeat(conn: WsConnection): void {
    this.stopHeartbeat();
    this.pingInterval = startWsHeartbeat(conn);
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<EdgeTTSConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取支持的语音列表
   */
  getVoices(): TTSVoice[] {
    return EDGE_VOICES;
  }

  /**
   * 合成语音并返回音频数据
   */
  async speak(options: TTSSpeakOptions): Promise<TTSSpeakResult> {
    const voiceId = options.voice || this.config.voice!;
    const voice = EDGE_VOICES.find((v) => v.id === voiceId);

    if (!options.text) {
      return { success: false, error: '合成文本不能为空' };
    }

    if (!voice) {
      return { success: false, error: `不支持的语音: "${voiceId}"` };
    }

    const otel = getOTelTracing();
    return otel.wrap(
      {
        name: 'voice.edge.tts.speak',
        attributes: { voice: voiceId, textLength: options.text.length },
      },
      async () => {
        try {
          const audioBuffer = await this.synthesize(options.text, voiceId);

          const durationEstimate = this.estimateDuration(
            options.text,
            options.speed
          );

          logger.info('Edge TTS 合成成功', {
            voice: voiceId,
            textLength: options.text.length,
            durationEstimate,
          });

          return {
            success: true,
            audioDurationSec: durationEstimate,
            voice,
            audioData: audioBuffer,
            audioFormat: 'mp3',
          };
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          void handleError(error, {
            module: 'services:voice:edgeTTS',
            action: 'speak',
          });
          return {
            success: false,
            error: `Edge TTS 合成失败: ${errorMsg}`,
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
    const voiceId = options.voice || this.config.voice!;
    const voice = EDGE_VOICES.find((v) => v.id === voiceId);

    if (!options.text) {
      return { success: false, error: '合成文本不能为空' };
    }

    if (!voice) {
      return { success: false, error: `不支持的语音: "${voiceId}"` };
    }

    try {
      const audioBuffer = await this.synthesize(options.text, voiceId);

      writeFileSync(options.filename, audioBuffer);

      const durationEstimate = this.estimateDuration(
        options.text,
        options.speed
      );

      logger.info('Edge TTS 保存成功', {
        voice: voiceId,
        filePath: options.filename,
        durationEstimate,
      });

      return {
        success: true,
        audioDurationSec: durationEstimate,
        filePath: options.filename,
        voice,
        audioData: audioBuffer,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      void handleError(error, {
        module: 'services:voice:edgeTTS',
        action: 'save',
        context: { filename: options.filename },
      });
      return {
        success: false,
        error: `Edge TTS 保存失败: ${errorMsg}`,
      };
    }
  }

  /**
   * 停止合成
   */
  stop(): void {
    this.stopHeartbeat();
    if (this.wsConnection) {
      closeConnection(this.wsConnection);
      this.wsConnection = null;
    }
    // 关闭并清空空闲连接池
    for (const { conn, ping } of this.idlePool.values()) {
      if (ping) clearInterval(ping);
      try {
        closeConnection(conn);
      } catch (err) {
        void handleError(err, {
          module: 'services:voice:edgeTTS',
          action: 'stop:pool',
        });
      }
    }
    this.idlePool.clear();
  }

  /**
   * 执行 Edge TTS 合成
   *
   * 流程：
   * 1. WebSocket 连接 + 心跳保活（优先复用池中同 voice 空闲连接，3.8/P1-3）
   * 2. 发送 synthesis.context
   * 3. 发送 SSML
   * 4. 接收音频二进制数据
   * 5. 等待 turn.end 信号
   * 6. 记录响应延迟
   *
   * 使用自适应超时（基于历史 P99 延迟），默认 20s，上限 60s。
   * turn.end 后连接不关闭，归还池中供下次同 voice 合成复用；连接失效自动降级新建。
   */
  private async synthesize(text: string, voice: string): Promise<Buffer> {
    const audioChunks: Buffer[] = [];
    const startTime = Date.now();
    const timeoutMs = this.calculateTimeout();
    const pooled = this.takeIdleConnection(voice);

    return new Promise((resolve, reject) => {
      let conn: WsConnection | null = null;
      let ping: ReturnType<typeof setInterval> | null = null;

      const timeout = setTimeout(() => {
        if (ping) clearInterval(ping);
        if (conn) {
          if (this.wsConnection === conn) {
            this.wsConnection = null;
          }
          try {
            conn.socket.destroy();
          } catch (error) {
            void handleError(error, {
              module: 'services:voice:edgeTTS',
              action: 'synthesize:timeout',
            });
          }
        }
        reject(new Error(`Edge TTS 合成超时（${timeoutMs}ms）`));
      }, timeoutMs);

      // 合成完成：归还连接入池（保持心跳）或关闭失效连接
      const finish = (buf: Buffer): void => {
        clearTimeout(timeout);
        this.recordLatency(Date.now() - startTime);
        if (this.wsConnection === conn) {
          this.wsConnection = null;
        }
        if (conn && conn.socket.writable && !conn.socket.destroyed) {
          this.returnIdleConnection(voice, conn, ping);
        } else if (conn) {
          if (ping) clearInterval(ping);
          try {
            closeConnection(conn);
          } catch (error) {
            void handleError(error, {
              module: 'services:voice:edgeTTS',
              action: 'synthesize:finish',
            });
          }
        }
        resolve(buf);
      };

      // 连接就绪后统一挂载处理器并发送合成请求
      const onConnectionReady = (
        c: WsConnection,
        p: ReturnType<typeof setInterval> | null
      ): void => {
        conn = c;
        ping = p;
        // 登记活跃连接，供 stop() 中止进行中的合成（连接复用池改造后保留此契约）
        this.wsConnection = c;

        c.onClose = () => {
          if (ping) clearInterval(ping);
          clearTimeout(timeout);
          if (this.wsConnection === c) {
            this.wsConnection = null;
          }
          // 连接已关闭，若仍在池中则移除
          this.idlePool.delete(voice);
        };

        c.onError = (error) => {
          if (ping) clearInterval(ping);
          clearTimeout(timeout);
          if (this.wsConnection === c) {
            this.wsConnection = null;
          }
          try {
            closeConnection(c);
          } catch (closeErr) {
            void handleError(closeErr, {
              module: 'services:voice:edgeTTS',
              action: 'synthesize:wsOnError:close',
            });
          }
          void handleError(error, {
            module: 'services:voice:edgeTTS',
            action: 'synthesize:wsOnError',
          });
          reject(error);
        };

        // 文本帧处理：等待 turn.end 信号
        c.onText = (data: Buffer) => {
          const payload = data.toString('utf8');

          // turn.end 表示合成结束，聚合所有音频块并返回
          if (payload.includes('turn.end')) {
            const totalBytes = audioChunks.reduce(
              (sum, ch) => sum + ch.length,
              0
            );
            logger.info('Edge TTS 合成完成', {
              audioChunks: audioChunks.length,
              totalBytes,
              duration: Date.now() - startTime,
              reused: pooled !== null,
            });
            finish(Buffer.concat(audioChunks));
          }
          // 其他文本帧（Context 确认、turn.start、WordBoundary）正常忽略
        };

        // 二进制帧处理：提取音频数据
        c.onBinary = (data: Buffer) => {
          const audioData = extractAudioFromBinaryFrame(data);

          if (audioData && audioData.length > 0) {
            audioChunks.push(audioData);
          } else {
            // 非音频帧（turn.start/end 的响应帧），正常跳过
            logger.debug('跳过非音频二进制帧', { length: data.length });
          }
        };

        // 发送 synthesis context（含请求头的文本帧）
        const contextPayload = buildContext(voice);
        sendWsFrame(c, WsOpcode.TEXT, Buffer.from(contextPayload, 'utf8'));

        // 发送 SSML（含请求头的文本帧）
        const ssmlPayload = buildSsmlPayload(
          text,
          voice,
          this.config.rate,
          this.config.pitch
        );
        sendWsFrame(c, WsOpcode.TEXT, Buffer.from(ssmlPayload, 'utf8'));
      };

      if (pooled) {
        // 复用池中空闲连接（心跳沿用）
        onConnectionReady(pooled.conn, pooled.ping);
      } else {
        // 新建连接
        const connectionId = randomUUID().replace(/-/g, '');
        const secMsGec = generateSecMsGec();
        const wsPath = `${EDGE_TTS_PATH}&ConnectionId=${connectionId}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
        const muid = generateMuid();

        wsConnect({
          host: EDGE_TTS_HOST,
          path: wsPath,
          port: 443,
          userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
          origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
          cookie: `muid=${muid};`,
        })
          .then((c) => {
            onConnectionReady(c, startWsHeartbeat(c));
          })
          .catch((error) => {
            clearTimeout(timeout);
            void handleError(error, {
              module: 'services:voice:edgeTTS',
              action: 'synthesize:wsHandshake',
            });
            reject(error);
          });
      }
    });
  }

  /**
   * 从空闲连接池中取同 voice 连接（有效才复用）
   * @returns 有效连接 + 其心跳；无空闲或连接失效返回 null
   */
  private takeIdleConnection(voice: string): {
    conn: WsConnection;
    ping: ReturnType<typeof setInterval> | null;
  } | null {
    const entry = this.idlePool.get(voice);
    if (!entry) return null;
    this.idlePool.delete(voice);
    if (!entry.conn.socket.writable || entry.conn.socket.destroyed) {
      if (entry.ping) clearInterval(entry.ping);
      try {
        closeConnection(entry.conn);
      } catch (error) {
        void handleError(error, {
          module: 'services:voice:edgeTTS',
          action: 'takeIdleConnection',
        });
      }
      return null;
    }
    return entry;
  }

  /**
   * 归还空闲连接入池（保留心跳，供同 voice 下次合成复用）
   * 每 voice 至多保留 1 个空闲连接，多余的先关闭。
   */
  private returnIdleConnection(
    voice: string,
    conn: WsConnection,
    ping: ReturnType<typeof setInterval> | null
  ): void {
    const existing = this.idlePool.get(voice);
    if (existing && existing.conn !== conn) {
      if (existing.ping) clearInterval(existing.ping);
      try {
        closeConnection(existing.conn);
      } catch (error) {
        void handleError(error, {
          module: 'services:voice:edgeTTS',
          action: 'returnIdleConnection',
        });
      }
    }
    this.idlePool.set(voice, { conn, ping });
  }

  /**
   * 创建流式 TTS 合成
   *
   * Edge TTS 的 WebSocket 协议本身支持流式返回音频，
   * 此方法在接收到每个音频块时立即回调，无需等待全部合成完成。
   *
   * 流程：连接 → 发送 context + SSML → 逐块回调 onData → turn.end 标记完成
   */
  createStream(options: TTSSpeakOptions): TTSStream {
    const voiceId = options.voice || this.config.voice!;
    let conn: WsConnection | null = null;
    let pingInterval: ReturnType<typeof setInterval> | null = null;
    let isCancelled = false;

    const dataCallbacks: Array<(chunk: Buffer, isLast: boolean) => void> = [];
    const errorCallbacks: Array<(error: Error) => void> = [];

    const stream: TTSStream = {
      onData(cb) {
        dataCallbacks.push(cb);
      },
      onError(cb) {
        errorCallbacks.push(cb);
      },
      cancel() {
        isCancelled = true;
        if (pingInterval) clearInterval(pingInterval);
        if (conn) {
          closeConnection(conn);
          conn = null;
        }
      },
    };

    const connectionId = randomUUID().replace(/-/g, '');
    const secMsGec = generateSecMsGec();
    const wsPath = `${EDGE_TTS_PATH}&ConnectionId=${connectionId}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
    const muid = generateMuid();

    wsConnect({
      host: EDGE_TTS_HOST,
      path: wsPath,
      port: 443,
      userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
      origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      cookie: `muid=${muid};`,
    })
      .then((c) => {
        if (isCancelled) {
          closeConnection(c);
          return;
        }

        conn = c;
        pingInterval = startWsHeartbeat(c);

        c.onError = (error) => {
          if (pingInterval) clearInterval(pingInterval);
          errorCallbacks.forEach((cb) => cb(error));
        };

        c.onClose = () => {
          if (pingInterval) clearInterval(pingInterval);
        };

        // 文本帧：检测 turn.end
        c.onText = (data) => {
          const payload = data.toString('utf8');
          if (payload.includes('turn.end')) {
            // 最后一个空块标记完成
            dataCallbacks.forEach((cb) => cb(Buffer.alloc(0), true));
            if (pingInterval) clearInterval(pingInterval);
            c.socket.end();
          }
        };

        // 二进制帧：提取音频数据
        c.onBinary = (data) => {
          if (isCancelled) return;
          const audioData = extractAudioFromBinaryFrame(data);
          if (audioData && audioData.length > 0) {
            dataCallbacks.forEach((cb) => cb(audioData, false));
          }
        };

        // 发送 synthesis context
        const contextPayload = buildContext(voiceId);
        sendWsFrame(c, WsOpcode.TEXT, Buffer.from(contextPayload, 'utf8'));

        // 发送 SSML
        const ssmlPayload = buildSsmlPayload(
          options.text,
          voiceId,
          this.config.rate,
          this.config.pitch
        );
        sendWsFrame(c, WsOpcode.TEXT, Buffer.from(ssmlPayload, 'utf8'));
      })
      .catch((error) => {
        errorCallbacks.forEach((cb) => cb(error));
      });

    return stream;
  }

  /**
   * 估计音频时长
   */
  private estimateDuration(text: string, speed?: number): number {
    const baseSpeed = speed ?? 1.0;
    const charsPerSecond = 12 * baseSpeed;
    return Math.max(1, Math.round(text.length / charsPerSecond));
  }
}
