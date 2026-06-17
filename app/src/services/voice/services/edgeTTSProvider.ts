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
import { createHash, randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { handleError } from '@modules/error/handleError';
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
  '/consumer/speech/synthesize/readaloud/edge/v1?TrustedClient=bing';

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
  onData: (data: Buffer) => void;
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
    const socket = tlsConnect(port, host, { servername: host });

    const handshake = [
      `GET ${path} HTTP/1.1`,
      `Host: ${host}:${port}`,
      `Upgrade: websocket`,
      `Connection: Upgrade`,
      `Sec-WebSocket-Key: ${key}`,
      `Sec-WebSocket-Version: 13`,
      `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36`,
      `Origin: https://${host}`,
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

      // 验证 accept key
      const acceptMatch = headers.match(/Sec-WebSocket-Accept:\s*(\S+)/i);
      if (!acceptMatch) {
        socket.destroy();
        reject(new Error('WebSocket 握手失败: 缺少 Sec-WebSocket-Accept'));
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
        onData: () => {},
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
        conn.onData(payload);
        break;

      case WsOpcode.BINARY:
        conn.onData(payload);
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
 * 生成合成上下文 SSML
 */
function buildSsml(
  text: string,
  voice: string,
  rate: string = '+0%',
  pitch: string = '+0Hz'
): string {
  return [
    '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">',
    `<voice name="${voice}">`,
    `<prosody rate="${rate}" pitch="${pitch}">`,
    `<s>${escapeXml(text)}</s>`,
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
 * 构建 synthesis context
 */
function buildContext(voice: string): string {
  const context = {
    synthesis: {
      audio: {
        metadataoptions: {
          sentenceBoundaryEnabled: false,
          wordBoundaryEnabled: false,
        },
        outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
      },
      request: {
        connection: {
          type: 'Upgrade',
        },
      },
    },
  };
  return JSON.stringify(context);
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
  private config: EdgeTTSConfig;
  private wsConnection: WsConnection | null = null;

  constructor(config?: EdgeTTSConfig) {
    this.config = {
      voice: 'zh-CN-XiaoxiaoNeural',
      rate: '+0%',
      pitch: '+0Hz',
      ...config,
    };
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
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
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
    if (this.wsConnection) {
      try {
        sendWsFrame(this.wsConnection, WsOpcode.CLOSE, Buffer.alloc(0));
        this.wsConnection.socket.end();
      } catch {
        // 忽略关闭错误
      }
      this.wsConnection = null;
    }
  }

  /**
   * 执行 Edge TTS 合成
   *
   * 流程：
   * 1. WebSocket 连接
   * 2. 发送 synthesis.context
   * 3. 发送 SSML
   * 4. 接收音频二进制数据
   * 5. 等待 turn.end 信号
   */
  private async synthesize(text: string, voice: string): Promise<Buffer> {
    const audioChunks: Buffer[] = [];
    const ssml = buildSsml(text, voice, this.config.rate!, this.config.pitch!);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Edge TTS 合成超时'));
      }, 30000);

      wsHandshake(EDGE_TTS_HOST, EDGE_TTS_PATH, 443)
        .then((conn) => {
          this.wsConnection = conn;

          let metadataReceived = false;

          conn.onClose = () => {
            clearTimeout(timeout);
            if (this.wsConnection === conn) {
              this.wsConnection = null;
            }
          };

          conn.onError = (error) => {
            clearTimeout(timeout);
            reject(error);
          };

          conn.onData = (data: Buffer) => {
            // 检查是否为文本帧（JSON 元数据）
            if (!metadataReceived) {
              const text = data.toString('utf8');
              if (text.includes('Context')) {
                metadataReceived = true;
                return;
              }
              if (text.includes('Path:')) {
                // turn.end 或 metadata 文本帧
                if (text.includes('turn.end')) {
                  clearTimeout(timeout);
                  conn.socket.end();
                  resolve(Buffer.concat(audioChunks));
                }
                return;
              }
              // 可能是音频二进制数据
              audioChunks.push(data);
            } else {
              // 检查是否文本帧
              const firstByte = data[0];
              if (firstByte < 128) {
                const text = data.toString('utf8');
                if (text.includes('turn.end')) {
                  clearTimeout(timeout);
                  conn.socket.end();
                  resolve(Buffer.concat(audioChunks));
                }
                return;
              }
              audioChunks.push(data);
            }
          };

          // 发送 synthesis context (JSON text frame)
          const contextJson = buildContext(voice);
          sendWsFrame(conn, WsOpcode.TEXT, Buffer.from(contextJson, 'utf8'));

          // 发送 SSML (text frame)
          sendWsFrame(conn, WsOpcode.TEXT, Buffer.from(ssml, 'utf8'));
        })
        .catch((error) => {
          clearTimeout(timeout);
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
