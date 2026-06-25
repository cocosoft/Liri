/**
 * EdgeTTSProvider
 * Edge TTS 提供者
 *
 * 通过 Microsoft Edge 浏览器免费 TTS WebSocket API 合成语音。
 * 无需 API Key，使用原生 tls 和 crypto 模块实现 WebSocket 客户端。
 *
 * 参考产品: edge-tts Python 库
 */

import { connect as tlsConnect, TLSSocket } from 'tls';
import { createHash, randomUUID, randomBytes } from 'crypto';
import { writeFileSync } from 'fs';
import { Logger, LogLevel, getOTelTracing } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type {
  TTSProvider,
  TTSVoice,
  TTSSpeakOptions,
  TTSSpeakResult,
} from './ttsTypes';

const logger = new Logger({ level: LogLevel.INFO });

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

/** WebSocket 操作码 */
const enum WsOpcode {
  CONTINUATION = 0x0,
  TEXT = 0x1,
  BINARY = 0x2,
  CLOSE = 0x8,
  PING = 0x9,
  PONG = 0xa,
}

/** WebSocket 连接状态 */
interface WsConnection {
  socket: TLSSocket;
  onText: (data: Buffer) => void;
  onBinary: (data: Buffer) => void;
  onClose: () => void;
  onError: (error: Error) => void;
}

/**
 * 生成 WebSocket 握手 key
 */
function generateWsKey(): string {
  const key = randomUUID().replace(/-/g, '').slice(0, 16);
  return Buffer.from(key).toString('base64');
}

/**
 * 计算 WebSocket 握手 accept
 */
function computeWsAccept(key: string): string {
  const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
  const hash = createHash('sha1')
    .update(key + GUID)
    .digest();
  return hash.toString('base64');
}

/**
 * 生成 Sec-MS-GEC DRM 令牌
 * 基于当前时间（对齐到5分钟）和 TrustedClientToken 的 SHA256 哈希
 */
function generateSecMsGec(): string {
  const WIN_EPOCH = 11_644_473_600; // Windows 文件时间纪元（1601-01-01）到 Unix 纪元（1970-01-01）的秒数

  // 获取当前 Unix 时间戳（秒）
  let ticks = Math.floor(Date.now() / 1000);
  // 转换为 Windows 文件时间
  ticks += WIN_EPOCH;
  // 向下取整到最近的 5 分钟
  ticks -= ticks % 300;
  // 转换为 100 纳秒间隔
  ticks *= 10_000_000;

  const hash = createHash('sha256')
    .update(`${ticks}6A5AA1D4EAFF4E9FB37E23D68491D6F4`)
    .digest('hex')
    .toUpperCase();

  return hash;
}

/**
 * 生成 muid Cookie 值（16 字节随机 hex，大写）
 */
function generateMuid(): string {
  return randomBytes(16).toString('hex').toUpperCase();
}

/**
 * 生成 JavaScript 风格日期字符串
 * 格式示例: "Thu Jun 25 2026 02:10:30 GMT+0000 (Coordinated Universal Time)"
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
 * 发送 WebSocket 帧
 */
function sendWsFrame(
  conn: WsConnection,
  opcode: number,
  payload: Buffer
): void {
  const maskKey = Buffer.from(
    randomUUID().replace(/-/g, '').slice(0, 4),
    'utf8'
  );
  const payloadLength = payload.length;

  let header: Buffer;

  if (payloadLength < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | payloadLength;
  } else if (payloadLength < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payloadLength, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payloadLength), 2);
  }

  const maskedPayload = Buffer.alloc(payloadLength);
  for (let i = 0; i < payloadLength; i++) {
    maskedPayload[i] = payload[i] ^ maskKey[i % 4];
  }

  conn.socket.write(Buffer.concat([header, maskKey, maskedPayload]));
}

/**
 * 执行 WebSocket 握手
 */
function wsHandshake(
  host: string,
  path: string,
  port: number
): Promise<WsConnection> {
  return new Promise((resolve, reject) => {
    const key = generateWsKey();
    const muid = generateMuid();
    const socket = tlsConnect(port, host, { servername: host });

    const handshake = [
      `GET ${path} HTTP/1.1`,
      `Host: ${host}:${port}`,
      `Upgrade: websocket`,
      `Connection: Upgrade`,
      `Pragma: no-cache`,
      `Cache-Control: no-cache`,
      `Sec-WebSocket-Key: ${key}`,
      `Sec-WebSocket-Version: 13`,
      `Accept-Encoding: gzip, deflate, br, zstd`,
      `Accept-Language: en-US,en;q=0.9`,
      `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
      `Origin: chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold`,
      `Cookie: muid=${muid};`,
      '',
      '',
    ].join('\r\n');

    let handshakeComplete = false;
    let responseBuffer = '';

    socket.on('data', (data) => {
      if (handshakeComplete) return;

      responseBuffer += data.toString();

      const headerEnd = responseBuffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      const headers = responseBuffer.slice(0, headerEnd);
      handshakeComplete = true;

      // 检查 HTTP 状态行
      const statusLine = headers.split('\r\n')[0] || '';
      const statusMatch = statusLine.match(/HTTP\/\d+\.\d+\s+(\d+)/);
      const httpStatus = statusMatch ? parseInt(statusMatch[1], 10) : 0;

      // 只有 101 Switching Protocols 才是成功的 WebSocket 握手
      if (httpStatus !== 101) {
        socket.destroy();
        const reason = headers.split('\r\n').slice(0, 3).join(' | ');
        reject(
          new Error(
            `WebSocket 握手失败: 服务器返回 ${httpStatus}（预期 101），原始响应: ${reason}`
          )
        );
        return;
      }

      // 验证 accept key
      const acceptMatch = headers.match(/Sec-WebSocket-Accept:\s*(\S+)/i);
      if (!acceptMatch) {
        socket.destroy();
        reject(
          new Error(`WebSocket 握手失败: 101 响应中缺少 Sec-WebSocket-Accept`)
        );
        return;
      }

      const expectedAccept = computeWsAccept(key);
      if (acceptMatch[1] !== expectedAccept) {
        socket.destroy();
        reject(new Error('WebSocket 握手失败: Sec-WebSocket-Accept 不匹配'));
        return;
      }

      const conn: WsConnection = {
        socket,
        onText: () => {},
        onBinary: () => {},
        onClose: () => {},
        onError: () => {},
      };

      // 设置帧解析
      let frameBuffer: Buffer = Buffer.from(
        responseBuffer.slice(headerEnd + 4)
      );

      socket.on('data', (frameData) => {
        frameBuffer = Buffer.concat([frameBuffer, frameData]);
        processWsFrames(conn, frameBuffer, (remaining) => {
          frameBuffer = remaining;
        });
      });

      socket.on('close', () => {
        conn.onClose();
      });

      socket.on('error', (error) => {
        conn.onError(error);
      });

      resolve(conn);
    });

    socket.on('error', reject);
    socket.write(handshake);
  });
}

/**
 * 处理 WebSocket 帧
 */
function processWsFrames(
  conn: WsConnection,
  buffer: Buffer,
  onConsumed: (remaining: Buffer) => void
): void {
  let offset = 0;

  while (offset < buffer.length) {
    if (buffer.length - offset < 2) break;

    const firstByte = buffer[offset];
    const secondByte = buffer[offset + 1];
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7f;
    let headerLen = 2;

    if (payloadLength === 126) {
      if (buffer.length - offset < 4) break;
      payloadLength = buffer.readUInt16BE(offset + 2);
      headerLen = 4;
    } else if (payloadLength === 127) {
      if (buffer.length - offset < 10) break;
      payloadLength = Number(buffer.readBigUInt64BE(offset + 2));
      headerLen = 10;
    }

    const maskLen = masked ? 4 : 0;
    const totalLen = headerLen + maskLen + payloadLength;

    if (buffer.length - offset < totalLen) break;

    let maskKey: Buffer | null = null;
    let payloadStart = offset + headerLen;

    if (masked) {
      maskKey = buffer.slice(payloadStart, payloadStart + 4);
      payloadStart += 4;
    }

    let payload = Buffer.from(
      buffer.slice(payloadStart, payloadStart + payloadLength)
    );

    if (maskKey) {
      for (let i = 0; i < payload.length; i++) {
        payload[i] = payload[i] ^ maskKey[i % 4];
      }
    }

    // 处理操作码
    switch (opcode) {
      case WsOpcode.TEXT:
        conn.onText(payload);
        break;

      case WsOpcode.BINARY:
        conn.onBinary(payload);
        break;

      case WsOpcode.CLOSE:
        conn.socket.end();
        return;

      case WsOpcode.PING:
        sendWsFrame(conn, WsOpcode.PONG, Buffer.alloc(0));
        break;

      case WsOpcode.PONG:
        // 忽略 pong
        break;
    }

    offset += totalLen;
  }

  onConsumed(buffer.slice(offset));
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
   */
  private startHeartbeat(conn: WsConnection): void {
    this.stopHeartbeat();
    this.pingInterval = setInterval(() => {
      try {
        if (conn.socket && conn.socket.writable) {
          sendWsFrame(conn, WsOpcode.PING, Buffer.alloc(0));
        } else {
          this.stopHeartbeat();
        }
      } catch (error) {
        void handleError(error, {
          module: 'services:voice:edgeTTS',
          action: 'heartbeat',
        });
        this.stopHeartbeat();
      }
    }, 15_000);
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
      try {
        sendWsFrame(this.wsConnection, WsOpcode.CLOSE, Buffer.alloc(0));
        this.wsConnection.socket.destroy();
      } catch (error) {
        void handleError(error, {
          module: 'services:voice:edgeTTS',
          action: 'stop',
        });
      }
      this.wsConnection = null;
    }
  }

  /**
   * 执行 Edge TTS 合成
   *
   * 流程：
   * 1. WebSocket 连接 + 心跳保活
   * 2. 发送 synthesis.context
   * 3. 发送 SSML
   * 4. 接收音频二进制数据
   * 5. 等待 turn.end 信号
   * 6. 记录响应延迟
   *
   * 使用自适应超时（基于历史 P99 延迟），默认 20s，上限 60s。
   */
  private async synthesize(text: string, voice: string): Promise<Buffer> {
    const audioChunks: Buffer[] = [];
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const timeoutMs = this.calculateTimeout();

      const timeout = setTimeout(() => {
        this.stopHeartbeat();
        if (this.wsConnection) {
          try {
            this.wsConnection.socket.destroy();
          } catch (error) {
            void handleError(error, {
              module: 'services:voice:edgeTTS',
              action: 'synthesize:timeout',
            });
          }
          this.wsConnection = null;
        }
        reject(new Error(`Edge TTS 合成超时（${timeoutMs}ms）`));
      }, timeoutMs);

      // 构建带动态参数的完整路径
      const connectionId = randomUUID().replace(/-/g, '');
      const secMsGec = generateSecMsGec();
      const wsPath = `${EDGE_TTS_PATH}&ConnectionId=${connectionId}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

      wsHandshake(EDGE_TTS_HOST, wsPath, 443)
        .then((conn) => {
          this.wsConnection = conn;
          this.startHeartbeat(conn);

          conn.onClose = () => {
            this.stopHeartbeat();
            clearTimeout(timeout);
            if (this.wsConnection === conn) {
              this.wsConnection = null;
            }
          };

          conn.onError = (error) => {
            this.stopHeartbeat();
            clearTimeout(timeout);
            void handleError(error, {
              module: 'services:voice:edgeTTS',
              action: 'synthesize:wsOnError',
            });
            reject(error);
          };

          // 文本帧处理：等待 turn.end 信号
          conn.onText = (data: Buffer) => {
            const payload = data.toString('utf8');

            // turn.end 表示合成结束，聚合所有音频块并返回
            if (payload.includes('turn.end')) {
              const totalBytes = audioChunks.reduce(
                (sum, c) => sum + c.length,
                0
              );
              logger.info('Edge TTS 合成完成', {
                audioChunks: audioChunks.length,
                totalBytes,
                duration: Date.now() - startTime,
              });
              this.stopHeartbeat();
              clearTimeout(timeout);
              this.recordLatency(Date.now() - startTime);
              conn.socket.end();
              resolve(Buffer.concat(audioChunks));
            }
            // 其他文本帧（Context 确认、turn.start、WordBoundary）正常忽略
          };

          // 二进制帧处理：提取音频数据
          conn.onBinary = (data: Buffer) => {
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
          sendWsFrame(conn, WsOpcode.TEXT, Buffer.from(contextPayload, 'utf8'));

          // 发送 SSML（含请求头的文本帧）
          const ssmlPayload = buildSsmlPayload(
            text,
            voice,
            this.config.rate,
            this.config.pitch
          );
          sendWsFrame(conn, WsOpcode.TEXT, Buffer.from(ssmlPayload, 'utf8'));
        })
        .catch((error) => {
          this.stopHeartbeat();
          clearTimeout(timeout);
          void handleError(error, {
            module: 'services:voice:edgeTTS',
            action: 'synthesize:wsHandshake',
          });
          reject(error);
        });
    });
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
