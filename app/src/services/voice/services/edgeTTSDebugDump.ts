/**
 * EdgeTTS Debug Dump
 *
 * 独立调试脚本：直接连接 Edge TTS WebSocket 并转储二进制帧数据到文件。
 *
 * 基于 edge-tts Python 库 v7+ 实现，使用正确的 DRM 生成 Sec-MS-GEC。
 *
 * 运行：bun run src/services/voice/services/edgeTTSDebugDump.ts
 * 输出：E:\PY\CODES\PY_APP\logs\edge_tts_debug.txt
 *        E:\PY\CODES\PY_APP\logs\edge_tts_frames\*.bin
 *        E:\PY\CODES\PY_APP\logs\edge_tts_output.mp3
 */

import { connect as tlsConnect, TLSSocket } from 'tls';
import { randomUUID, randomBytes, createHash } from 'crypto';
import { writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { handleError } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'services:voice:services:edgeTTSDebugDump',
  level: LogLevel.INFO,
});

// ============ Constants ============
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WSS_HOST = 'speech.platform.bing.com';
const WSS_PATH = '/consumer/speech/synthesize/readaloud/edge/v1';
const WIN_EPOCH = 11644473600;
const S_TO_NS = 1e9;
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;

const LOG_DIR = 'E:\\PY\\CODES\\PY_APP\\logs';
const DUMP_DIR = join(LOG_DIR, 'edge_tts_frames');

// ============ WebSocket Opcodes ============
const enum WsOpcode {
  CONTINUATION = 0x0,
  TEXT = 0x1,
  BINARY = 0x2,
  CLOSE = 0x8,
  PING = 0x9,
  PONG = 0xa,
}

// ============ DRM (同 Python edge-tts) ============

/** 生成 Sec-MS-GEC 令牌（与 Python edge-tts DRM 一致） */
function generateSecMsGec(): string {
  const unixTs = Date.now() / 1000;
  // Windows file time epoch (1601-01-01)
  const winTs = unixTs + WIN_EPOCH;
  // Round down to nearest 5 minutes (300 seconds)
  const rounded = winTs - (winTs % 300);
  // Convert to 100-nanosecond intervals
  const ticks = Math.floor((rounded * S_TO_NS) / 100);
  const strToHash = `${ticks}${TRUSTED_CLIENT_TOKEN}`;
  return createHash('sha256')
    .update(strToHash, 'ascii')
    .digest('hex')
    .toUpperCase();
}

/** 生成 MUID */
function generateMuid(): string {
  return randomBytes(16).toString('hex').toUpperCase();
}

// ============ Logging ============
function debugLog(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  appendFileSync(join(LOG_DIR, 'edge_tts_debug.txt'), line);
  // eslint-disable-next-line no-console
  console.log(msg);
}

// ============ WebSocket Functions ============

/** 生成 WebSocket 握手 key */
function generateKey(): string {
  return randomBytes(16).toString('base64');
}

/** 发送 WebSocket 帧（客户端→服务器：必须加掩码） */
function sendWsFrame(
  socket: TLSSocket,
  opcode: WsOpcode,
  payload: Buffer
): void {
  const maskKey = randomBytes(4);
  const maskedPayload = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) {
    maskedPayload[i] = payload[i] ^ maskKey[i % 4];
  }

  const header = Buffer.alloc(2);
  header[0] = 0x80 | opcode; // FIN + opcode
  header[1] = 0x80; // MASK bit set

  if (payload.length < 126) {
    header[1] |= payload.length;
    socket.write(Buffer.concat([header, maskKey, maskedPayload]));
  } else if (payload.length < 65536) {
    header[1] |= 126;
    const ext = Buffer.alloc(2);
    ext.writeUInt16BE(payload.length, 0);
    socket.write(Buffer.concat([header, ext, maskKey, maskedPayload]));
  } else {
    header[1] |= 127;
    const ext = Buffer.alloc(8);
    ext.writeBigUInt64BE(BigInt(payload.length), 0);
    socket.write(Buffer.concat([header, ext, maskKey, maskedPayload]));
  }
}

/** 建立 WebSocket 连接（HTTP 101 握手）并缓存 WebSocket 帧数据 */
function wsConnect(
  socket: TLSSocket,
  frameBuffer: { buffer: Buffer }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const key = generateKey();
    const connId = randomUUID().replace(/-/g, '');
    const secMsGec = generateSecMsGec();
    const muid = generateMuid();

    const queryParams = `?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&ConnectionId=${connId}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

    const req = [
      `GET ${WSS_PATH}${queryParams} HTTP/1.1`,
      `Host: ${WSS_HOST}`,
      `Upgrade: websocket`,
      `Connection: Upgrade`,
      `Sec-WebSocket-Key: ${key}`,
      `Sec-WebSocket-Version: 13`,
      `Origin: chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold`,
      `Pragma: no-cache`,
      `Cache-Control: no-cache`,
      `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0`,
      `Cookie: muid=${muid};`,
      '',
      '',
    ].join('\r\n');

    // 累积所有原始数据，直到 HTTP 头解析完成
    const allChunks: Buffer[] = [];
    let totalBytes = 0;
    let httpHeadersReceived = false;
    let headerByteEnd = -1; // WebSocket 数据起始位置

    const onData = (chunk: Buffer) => {
      allChunks.push(chunk);
      totalBytes += chunk.length;

      if (!httpHeadersReceived) {
        // 在累积的 UTF8 文本中搜索 \r\n\r\n
        const fullText = Buffer.concat(allChunks).toString('utf8');
        const headerEnd = fullText.indexOf('\r\n\r\n');
        if (headerEnd !== -1) {
          httpHeadersReceived = true;
          // headerEnd 是 \r\n\r\n 之前的位置，加上 4 就是 \r\n\r\n 之后的位置
          // 这个位置在 UTF8 文本中的偏移等于字节偏移（因为都是 ASCII 字符）
          headerByteEnd = headerEnd + 4;

          if (fullText.includes('101')) {
            debugLog('HTTP 101 handshake OK');
            // 将 WebSocket 数据（HTTP 头之后的所有字节）移到 frameBuffer
            if (totalBytes > headerByteEnd) {
              const allData = Buffer.concat(allChunks);
              frameBuffer.buffer = Buffer.concat([
                frameBuffer.buffer,
                allData.slice(headerByteEnd),
              ]);
              debugLog(
                `WebSocket data from handshake: ${totalBytes - headerByteEnd} bytes`
              );
            }
            resolve();
          } else {
            reject(
              new Error(`Handshake failed: ${fullText.substring(0, 200)}`)
            );
          }
        }
      } else {
        // 握手完成后到达的数据直接进 frameBuffer
        frameBuffer.buffer = Buffer.concat([frameBuffer.buffer, chunk]);
      }
    };
    socket.on('data', onData);
    socket.write(req);
  });
}

// ============ Main ============
async function main(): Promise<void> {
  // 创建输出目录
  if (!existsSync(DUMP_DIR)) mkdirSync(DUMP_DIR, { recursive: true });
  // 清空调试日志
  writeFileSync(join(LOG_DIR, 'edge_tts_debug.txt'), '');

  debugLog('=== Edge TTS Debug Dump ===');
  debugLog(`Dump directory: ${DUMP_DIR}`);
  debugLog(`Sec-MS-GEC: ${generateSecMsGec()}`);
  debugLog(`Sec-MS-GEC-Version: ${SEC_MS_GEC_VERSION}`);

  const socket = tlsConnect({
    host: WSS_HOST,
    port: 443,
    servername: WSS_HOST,
  });

  socket.on('error', (err) => {
    debugLog(`Socket error: ${err.message}`);
  });
  socket.on('close', () => {
    debugLog('Socket closed');
  });
  socket.on('end', () => {
    debugLog('Socket end');
  });

  // 音频数据收集
  const audioChunks: Buffer[] = [];
  let binaryFrameCount = 0;
  let textFrameCount = 0;

  // 共享 frameBuffer（wsConnect 写入，processWsFrames 读取）
  const sharedFrameBuffer: { buffer: Buffer } = { buffer: Buffer.alloc(0) };

  // 握手
  await wsConnect(socket, sharedFrameBuffer);
  debugLog('WebSocket handshake OK');

  // 用定时器轮询处理 WebSocket 帧（替代 socket.on('data')）
  const processingInterval = setInterval(() => {
    processWsFrames();
  }, 50);

  function processWsFrames(): void {
    const bufLen = sharedFrameBuffer.buffer.length;
    if (bufLen > 0) {
      debugLog(`[POLL] buffer has ${bufLen} bytes, processing...`);
    }
    let offset = 0;
    while (offset < bufLen) {
      if (sharedFrameBuffer.buffer.length - offset < 2) break;

      const firstByte = sharedFrameBuffer.buffer[offset];
      const secondByte = sharedFrameBuffer.buffer[offset + 1];
      const opcode = firstByte & 0x0f;
      const masked = (secondByte & 0x80) !== 0;
      let payloadLength = secondByte & 0x7f;
      let headerLen = 2;

      if (payloadLength === 126) {
        if (sharedFrameBuffer.buffer.length - offset < 4) break;
        payloadLength = sharedFrameBuffer.buffer.readUInt16BE(offset + 2);
        headerLen = 4;
      } else if (payloadLength === 127) {
        if (sharedFrameBuffer.buffer.length - offset < 10) break;
        payloadLength = Number(
          sharedFrameBuffer.buffer.readBigUInt64BE(offset + 2)
        );
        headerLen = 10;
      }

      const maskLen = masked ? 4 : 0;
      const totalLen = headerLen + maskLen + payloadLength;
      if (sharedFrameBuffer.buffer.length - offset < totalLen) break;

      let payloadStart = offset + headerLen;
      if (masked) payloadStart += 4;

      let payload = Buffer.from(
        sharedFrameBuffer.buffer.slice(
          payloadStart,
          payloadStart + payloadLength
        )
      );

      // unmask
      if (masked) {
        const maskKey = sharedFrameBuffer.buffer.slice(
          offset + headerLen,
          offset + headerLen + 4
        );
        for (let i = 0; i < payload.length; i++) {
          payload[i] = payload[i] ^ maskKey[i % 4];
        }
      }

      switch (opcode) {
        case WsOpcode.TEXT: {
          textFrameCount++;
          const text = payload.toString('utf8');
          if (textFrameCount <= 5) {
            debugLog(`[TEXT #${textFrameCount}] ${text.substring(0, 300)}`);
          }
          break;
        }
        case WsOpcode.BINARY: {
          binaryFrameCount++;
          const hex64 = payload
            .slice(0, Math.min(64, payload.length))
            .toString('hex');
          const headerLenBE = payload.readUInt16BE(0);

          debugLog(
            `[BINARY #${binaryFrameCount}] ${payload.length} bytes, headerLenBE=${headerLenBE}`
          );
          debugLog(`  hex(64): ${hex64}`);
          debugLog(
            `  utf8(64): ${payload
              .slice(0, Math.min(128, payload.length))
              .toString('utf8')
              .replace(/[\x00-\x1F]/g, '.')}`
          );

          // 保存原始帧
          const frameFile = join(
            DUMP_DIR,
            `frame_${binaryFrameCount}_${payload.length}.bin`
          );
          writeFileSync(frameFile, payload);
          debugLog(`  saved: ${frameFile}`);

          // 尝试提取音频数据
          const extracted = extractAudio(payload);
          if (extracted) {
            audioChunks.push(extracted);
            debugLog(`  -> audio extracted: ${extracted.length} bytes`);

            const audioFile = join(
              DUMP_DIR,
              `audio_chunk_${binaryFrameCount}.mp3`
            );
            writeFileSync(audioFile, extracted);
            debugLog(`  audio saved: ${audioFile}`);
          } else {
            debugLog(`  -> NOT audio`);
          }
          break;
        }
        case WsOpcode.CLOSE:
          debugLog('[CLOSE]');
          finalize();
          return;
      }

      offset += totalLen;
    }

    sharedFrameBuffer.buffer = sharedFrameBuffer.buffer.slice(offset);
  }

  function finalize(): void {
    clearInterval(processingInterval);
    debugLog(`\n=== Summary ===`);
    debugLog(`Binary frames: ${binaryFrameCount}`);
    debugLog(`Text frames: ${textFrameCount}`);
    debugLog(`Audio chunks: ${audioChunks.length}`);

    if (audioChunks.length > 0) {
      const merged = Buffer.concat(audioChunks);
      const outFile = join(LOG_DIR, 'edge_tts_output.mp3');
      writeFileSync(outFile, merged);
      debugLog(`Merged audio: ${outFile} (${merged.length} bytes)`);
    }

    sendWsFrame(socket, WsOpcode.CLOSE, Buffer.alloc(0));
    socket.end();
    debugLog('Done');
  }

  // 发送 synthesis context
  debugLog(`Sending speech.config (socket writable=${socket.writable})...`);
  const contextPayload =
    'X-Timestamp:' +
    new Date().toString() +
    '\r\n' +
    'Content-Type:application/json; charset=utf-8\r\n' +
    'Path:speech.config\r\n\r\n' +
    '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n';
  sendWsFrame(socket, WsOpcode.TEXT, Buffer.from(contextPayload, 'utf8'));

  // 发送 SSML
  setTimeout(() => {
    debugLog('Sending SSML...');
    const requestId = randomUUID().replace(/-/g, '');
    const timestamp = new Date().toString();
    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='zh-CN-XiaoxiaoNeural'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>你好，欢迎使用语音合成系统。</prosody></voice></speak>`;
    const ssmlPayload =
      `X-RequestId:${requestId}\r\n` +
      'Content-Type:application/ssml+xml\r\n' +
      `X-Timestamp:${timestamp}Z\r\n` +
      'Path:ssml\r\n\r\n' +
      ssml;
    sendWsFrame(socket, WsOpcode.TEXT, Buffer.from(ssmlPayload, 'utf8'));
  }, 500);

  // Wait and finalize
  setTimeout(() => {
    finalize();
  }, 12000);
}

/**
 * 尝试从 Edge TTS 二进制帧中提取音频数据
 *
 * 根据 edge-tts Python 库的 get_headers_and_data 函数，Edge TTS 二进制帧格式为：
 *   [2字节 header_length Big Endian][header 文本数据][\r\n][音频数据]
 *
 * 参考 get_headers_and_data:
 *   headers = {}
 *   for line in data[:header_length].split(b"\r\n"):
 *       key, value = line.split(b":", 1)
 *       headers[key] = value
 *   return headers, data[header_length + 2:]
 *
 * 其中 header_length 来自前2字节 readUInt16BE(0)，
 * data[:header_length] 读取 header_length 个字节（从头开始，**包含**前2字节自身），
 * data[header_length + 2:] 跳过 header_length 字节 + 2字节 \r\n 分隔。
 */
function extractAudio(data: Buffer): Buffer | null {
  if (data.length < 4) return null;

  const headerLength = data.readUInt16BE(0);

  // 尝试方法 A: Python 方式 — data[:header_length] 包含前2字节自身
  if (headerLength > 0 && headerLength + 2 <= data.length) {
    try {
      const headerText = data.slice(0, headerLength).toString('utf8');
      if (headerText.includes('Path:audio')) {
        return data.slice(headerLength + 2);
      }
    } catch (err) {
      // not utf8, try next

      handleError(err, {
        module: 'services:voice',
        action: 'decodeUtf8PrefixTryNext',
      });
    }
  }

  // 尝试方法 B: header_length 不包括自身（从偏移2开始）
  if (headerLength > 0 && 2 + headerLength + 2 <= data.length) {
    try {
      const headerText = data.slice(2, 2 + headerLength).toString('utf8');
      if (headerText.includes('Path:audio')) {
        return data.slice(2 + headerLength + 2);
      }
    } catch (err) {
      // not utf8

      handleError(err, {
        module: 'services:voice',
        action: 'decodeUtf8Prefix',
      });
    }
  }

  // 尝试方法 C: 直接搜索 Path:audio\r\n
  const marker = 'Path:audio\r\n';
  const markerIdx = data.indexOf(marker);
  if (markerIdx !== -1) {
    return data.slice(markerIdx + marker.length);
  }

  // 尝试方法 D: MP3 魔术字节
  if (data[0] === 0xff && (data[1] & 0xe0) === 0xe0) {
    return data;
  }

  return null;
}

main().catch((err) => {
  debugLog(`Fatal error: ${err.message}`);
});
