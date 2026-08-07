/**
 * 本地 STT stdin 协议单元测试（语音系统升级 3.2 / P1-2）
 * 覆盖 WAV 头解析、worker 脚本二进制协议断言、日志 key= 脱敏
 */

import { describe, it, expect } from 'bun:test';

import {
  parseWavHeader,
  buildWorkerScript,
  assertAudioInputSize,
} from '../../src/services/voice/services/localSTTProvider.js';
import { logRedact } from '../../src/monitoring/logs/redact/LogRedact.js';

/**
 * 构造标准 44 字节 WAV 头（PCM16）
 * @param sampleRate 采样率
 * @param channels 声道数
 * @param dataBytes PCM 数据字节数
 */
function makeWavHeader(
  sampleRate: number,
  channels: number,
  dataBytes: number
): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;
  const blockAlign = channels * 2;

  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8, 'latin1');
  header.write('fmt ', 12, 'latin1');
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // audioFormat = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36, 'latin1');
  header.writeUInt32LE(dataBytes, 40);

  return header;
}

describe('parseWavHeader', () => {
  it('解析标准 PCM WAV 头（16kHz mono）', () => {
    const wav = makeWavHeader(16000, 1, 3200);
    const parsed = parseWavHeader(wav);
    expect(parsed).not.toBeNull();
    expect(parsed!.sampleRate).toBe(16000);
    expect(parsed!.channels).toBe(1);
    expect(parsed!.dataOffset).toBe(44);
  });

  it('解析 48kHz 双声道 WAV', () => {
    const wav = makeWavHeader(48000, 2, 6400);
    const parsed = parseWavHeader(wav);
    expect(parsed!.sampleRate).toBe(48000);
    expect(parsed!.channels).toBe(2);
    expect(parsed!.dataOffset).toBe(44);
  });

  it('非 RIFF/WAVE 返回 null', () => {
    expect(parseWavHeader(Buffer.alloc(44))).toBeNull();
  });

  it('过短数据返回 null', () => {
    expect(parseWavHeader(Buffer.from('RIFF'))).toBeNull();
  });

  it('非 PCM 编码（IEEE float=3）返回 null', () => {
    const wav = makeWavHeader(16000, 1, 3200);
    wav.writeUInt16LE(3, 20); // audioFormat = IEEE float
    expect(parseWavHeader(wav)).toBeNull();
  });
});

describe('buildWorkerScript（stdin 二进制协议）', () => {
  const script = buildWorkerScript();

  it('使用 buffer 模式读取 stdin（无文本解码）', () => {
    expect(script).toContain('sys.stdin.buffer.read');
  });

  it('定义 protocol=2 二进制直传分支（read_exact + PCM16→float32）', () => {
    expect(script).toContain('PROTOCOL_BINARY = 2');
    expect(script).toContain('read_exact(audio_len)');
    expect(script).toContain('np.frombuffer(raw, dtype="<i2")');
  });

  it('保留 protocol=1 audio_path 兼容分支', () => {
    expect(script).toContain('protocol = int(request.get("protocol", 1))');
    expect(script).toContain('audio_path = request["audio_path"]');
    expect(script).toContain('sf.read(audio_path)');
  });

  it('流式协议一次定义：chunk / finalize / error', () => {
    expect(script).toContain('"type": "finalize"');
    expect(script).toContain('"type": "error"');
    expect(script).toContain('# 流式协议一次定义：chunk 留给流式消费');
  });
});

describe('日志脱敏（3.3 / P1-4 双保险）', () => {
  it('URL query 参数 key= 被脱敏', () => {
    const line =
      'connect wss://generativelanguage.googleapis.com/ws/...BidiGenerateContent?key=AIzaSyFakeKey123456';
    const redacted = logRedact.redact(line);
    expect(redacted).toContain('key=***REDACTED***');
    expect(redacted).not.toContain('AIzaSyFakeKey123456');
  });

  it('JSON 行内 key= 值被脱敏', () => {
    const line = JSON.stringify({
      url: 'wss://x/ws?key=AIzaSySecret',
      extra: 1,
    });
    const redacted = logRedact.redact(line);
    expect(redacted).not.toContain('AIzaSySecret');
  });

  it('X-Goog-Api-Key header 被脱敏', () => {
    const line = 'X-Goog-Api-Key: AIzaSyHeaderKey';
    const redacted = logRedact.redact(line);
    expect(redacted).not.toContain('AIzaSyHeaderKey');
  });

  it('非 URL query 上下文的 key= 不误伤（保守边界）', () => {
    const line = 'debug key=something-visible';
    const redacted = logRedact.redact(line);
    expect(redacted).toBe(line);
  });
});

describe('assertAudioInputSize（§6 stdin 25MB 上限）', () => {
  it('低于上限正常通过', () => {
    expect(() => assertAudioInputSize(Buffer.alloc(1024))).not.toThrow();
  });

  it('恰好等于上限正常通过', () => {
    expect(() => assertAudioInputSize(Buffer.alloc(25 * 1024 * 1024))).not.toThrow();
  });

  it('超过 25MB 抛错（交 registry 故障转移）', () => {
    expect(() =>
      assertAudioInputSize(Buffer.alloc(25 * 1024 * 1024 + 1))
    ).toThrow(/25MB 上限/);
  });
});
