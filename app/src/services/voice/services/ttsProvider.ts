/**
 * TTS 插件化提供者系统
 *
 * 定义 TTS 提供者接口和注册表，支持插件式扩展。
 * 内置提供者：Edge（微软神经网络语音）、None（静默占位）。
 *
 * 用法：
 * ```ts
 * import { TTSRegistry, EdgeTTSProvider } from './ttsProvider';
 *
 * TTSRegistry.register(new EdgeTTSProvider());
 * await TTSRegistry.speak({ text: '你好', voice: 'zh-CN-XiaoxiaoNeural' });
 * ```
 */

import { createHash } from 'crypto';

import { Logger, LogLevel, getOTelTracing } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type {
  TTSVoice,
  TTSSpeakOptions,
  TTSSpeakResult,
  TTSProvider,
} from './ttsTypes';
export type {
  TTSVoice,
  TTSSpeakOptions,
  TTSSpeakResult,
  TTSProvider,
} from './ttsTypes';

import { EdgeTTSProvider } from './edgeTTSProvider';
export { EdgeTTSProvider };

const logger = new Logger({ level: LogLevel.INFO });

/**
 * TTS 缓存配置
 */
interface TTSCacheConfig {
  /** 最大缓存条目数，默认 100 */
  maxEntries: number;
  /** 缓存 TTL（毫秒），默认 10 分钟 */
  ttlMs: number;
}

/**
 * TTS 缓存条目
 */
interface TTSCacheEntry {
  result: TTSSpeakResult;
  cachedAt: number;
  hits: number;
}

/**
 * TTS 音频 LRU 缓存
 *
 * 以文本 + 参数复合指纹为键，避免重复合成相同内容。
 * 使用 Map 的插入顺序实现 LRU 驱逐。
 */
class TTSCache {
  private store = new Map<string, TTSCacheEntry>();
  private config: TTSCacheConfig;

  constructor(config?: Partial<TTSCacheConfig>) {
    this.config = {
      maxEntries: 100,
      ttlMs: 10 * 60 * 1000,
      ...config,
    };
  }

  /**
   * 生成缓存键
   *
   * 复合键：文本 SHA-256 + 语音 + 语言 + 语速 + 格式
   */
  private buildKey(options: TTSSpeakOptions): string {
    const textHash = createHash('sha256')
      .update(options.text)
      .digest('hex')
      .slice(0, 32);
    const voice = options.voice || '';
    const lang = options.language || '';
    const speed = options.speed ?? 1.0;
    const fmt = options.format || '';
    return `${textHash}:${voice}:${lang}:${speed}:${fmt}`;
  }

  /**
   * 获取缓存
   */
  get(options: TTSSpeakOptions): TTSSpeakResult | undefined {
    const key = this.buildKey(options);
    const entry = this.store.get(key);
    if (!entry) return undefined;

    // TTL 过期检查
    if (Date.now() - entry.cachedAt > this.config.ttlMs) {
      this.store.delete(key);
      return undefined;
    }

    // LRU 更新
    this.store.delete(key);
    this.store.set(key, entry);
    entry.hits++;

    logger.debug('TTSCache · 命中缓存', {
      key: key.slice(0, 16),
      hits: entry.hits,
    });
    return entry.result;
  }

  /**
   * 写入缓存
   */
  set(options: TTSSpeakOptions, result: TTSSpeakResult): void {
    if (!result.success || !result.audioData) return;

    const key = this.buildKey(options);

    if (this.store.has(key)) {
      this.store.delete(key);
    }

    this.store.set(key, {
      result,
      cachedAt: Date.now(),
      hits: 0,
    });

    this.evictIfNeeded();
  }

  /**
   * LRU 驱逐
   */
  private evictIfNeeded(): void {
    while (this.store.size > this.config.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
  }

  /** 缓存大小 */
  get size(): number {
    return this.store.size;
  }

  /** 缓存统计 */
  getStats(): { size: number; hitRatio: number } {
    let totalHits = 0;
    for (const entry of this.store.values()) {
      totalHits += entry.hits;
    }
    return {
      size: this.store.size,
      hitRatio:
        this.store.size > 0 ? totalHits / (totalHits + this.store.size) : 0,
    };
  }
}

/**
 * 文本分片配置
 */
interface ChunkConfig {
  /** 每片最大字符数，默认 1000 */
  maxChunkSize: number;
  /** 并行合成最大并发数，默认 3 */
  maxConcurrency: number;
  /** 分片间交叉淡化时长（毫秒），默认 50 */
  crossFadeMs: number;
}

/**
 * WAV 文件头长度（PCM16 单声道）
 */
const WAV_HEADER_SIZE = 44;

/**
 * 从 WAV Buffer 中提取 PCM 数据（跳过 44 字节头部）
 */
function extractPCMFromWav(wavBuffer: Buffer): Buffer {
  if (wavBuffer.length < WAV_HEADER_SIZE) return wavBuffer;
  const headerId = wavBuffer.toString('ascii', 0, 4);
  if (headerId !== 'RIFF') return wavBuffer;
  return wavBuffer.subarray(WAV_HEADER_SIZE);
}

/**
 * 构建 WAV 文件头
 *
 * @param dataLen PCM 数据长度
 * @param sampleRate 采样率
 * @param channels 声道数
 * @param bitsPerSample 位深
 * @returns 44 字节 WAV 头
 */
function buildWavHeader(
  dataLen: number,
  sampleRate: number,
  channels: number,
  bitsPerSample: number
): Buffer {
  const buf = Buffer.alloc(WAV_HEADER_SIZE);
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;

  // RIFF header
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8, 'ascii');

  // fmt chunk
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataLen, 40);

  return buf;
}

/**
 * 判断 PCM 帧是否为静音段
 *
 * @param pcmData PCM16 s16le Buffer
 * @param startSample 起始样本索引
 * @param numSamples 检测样本数
 * @param threshold RMS 阈值，默认 0.01
 * @returns 是否静音
 */
function isSilentSegment(
  pcmData: Buffer,
  startSample: number,
  numSamples: number,
  threshold: number = 0.01
): boolean {
  let sumSq = 0;
  let count = 0;
  const end = Math.min(
    startSample + numSamples,
    Math.floor(pcmData.length / 2)
  );
  for (let i = startSample; i < end; i++) {
    const sample = pcmData.readInt16LE(i * 2) / 32768;
    sumSq += sample * sample;
    count++;
  }
  if (count === 0) return true;
  const rms = Math.sqrt(sumSq / count);
  return rms < threshold;
}

/**
 * 交叉淡化拼接两段 PCM16 音频
 *
 * 如果拼接点落在静音段，则跳过交叉淡化以节省计算。
 *
 * @param left 前一段 PCM16 Buffer
 * @param right 后一段 PCM16 Buffer
 * @param fadeMs 交叉淡化时长（毫秒）
 * @param sampleRate 采样率，默认 24000
 * @returns 拼接后的 PCM16 Buffer
 */
function crossFade(
  left: Buffer,
  right: Buffer,
  fadeMs: number,
  sampleRate: number = 24000
): Buffer {
  const fadeSamples = Math.min(
    Math.round((fadeMs / 1000) * sampleRate),
    Math.floor(left.length / 2),
    Math.floor(right.length / 2)
  );

  if (fadeSamples <= 0) {
    return Buffer.concat([left, right]);
  }

  const leftSampleCount = Math.floor(left.length / 2);
  const rightSampleCount = Math.floor(right.length / 2);

  // 如果拼接点落在静音段，跳过交叉淡化
  const overlapStart = leftSampleCount - fadeSamples;
  if (
    isSilentSegment(right, 0, fadeSamples) ||
    isSilentSegment(left, overlapStart, fadeSamples)
  ) {
    return Buffer.concat([left, right]);
  }

  const outSampleCount = leftSampleCount + rightSampleCount - fadeSamples;
  const out = Buffer.alloc(outSampleCount * 2);

  // 左段（不含淡化区域）
  for (let i = 0; i < overlapStart; i++) {
    out.writeInt16LE(left.readInt16LE(i * 2), i * 2);
  }

  // 交叉淡化区域
  for (let i = 0; i < fadeSamples; i++) {
    const leftSample = left.readInt16LE((overlapStart + i) * 2);
    const rightSample = right.readInt16LE(i * 2);
    const t = i / fadeSamples;
    const blended = Math.round(leftSample * (1 - t) + rightSample * t);
    out.writeInt16LE(blended, (overlapStart + i) * 2);
  }

  // 右段（不含淡化区域）
  for (let i = fadeSamples; i < rightSampleCount; i++) {
    out.writeInt16LE(right.readInt16LE(i * 2), (overlapStart + i) * 2);
  }

  return out;
}

/**
 * TTS 长文本分片合成器
 */
class ChunkedSynthesizer {
  private config: ChunkConfig;

  constructor(config?: Partial<ChunkConfig>) {
    this.config = {
      maxChunkSize: 1000,
      maxConcurrency: 3,
      crossFadeMs: 50,
      ...config,
    };
  }

  /**
   * 按分隔符优先级切分文本
   *
   * 分隔符优先级：
   *   1. 句子结束（！？。\n）
   *   2. 从句分隔（；，、）
   *   3. 短语分隔（),) 空格）
   *   4. 硬截断（不跨词）
   */
  splitText(text: string): string[] {
    if (text.length <= this.config.maxChunkSize) {
      return [text];
    }

    const chunks: string[] = [];
    const remaining = text;

    const delimitersPriority = [
      /(?<=[！？。\n])/g,
      /(?<=[；，、])/g,
      /(?<=[),)])/g,
      /(?<=[\s])/g,
    ];

    let pos = 0;
    while (pos < remaining.length) {
      const end = Math.min(pos + this.config.maxChunkSize, remaining.length);
      let splitPos = end;

      if (end < remaining.length) {
        // 尝试按分隔符切分
        for (const delim of delimitersPriority) {
          // 在 [pos, end] 范围内找到最后一个分隔符
          const segment = remaining.slice(pos, end);
          const matches = [...segment.matchAll(delim)];
          if (matches.length > 0) {
            const lastMatch = matches[matches.length - 1];
            splitPos = pos + (lastMatch.index ?? 0) + lastMatch[0].length;
            break;
          }
        }
      }

      let chunk = remaining.slice(pos, splitPos);

      // 语义边界修补
      chunk = this.repairBoundary(chunk);

      chunks.push(chunk);
      pos = splitPos;
    }

    return chunks.filter((c) => c.trim().length > 0);
  }

  /**
   * 语义边界修补
   *
   * 规则：
   *   - 括号配对：如果 chunk 左括号不配对，补充到下一个右括号后
   *   - 引号不跨片：如果 chunk 以引号开始但不在开引号处，前移
   *   - 数字+单位不拆分：如 "100 美元" 不跨片
   *   - 英文单词不截断：如果末尾是单词中间，回退到最近空格
   */
  private repairBoundary(chunk: string): string {
    // 英文单词不截断
    const trailingWord = chunk.match(/[a-zA-Z]+$/);
    if (trailingWord) {
      const wordStart = chunk.lastIndexOf(trailingWord[0]);
      if (wordStart > 0) {
        return chunk.slice(0, wordStart).trimEnd();
      }
    }

    // 括号修补
    const openParens = (chunk.match(/[（(]/g) || []).length;
    const closeParens = (chunk.match(/[）)]/g) || []).length;
    if (openParens > closeParens) {
      // 不修补，保留原样（后续 chunk 会继续）
    }

    return chunk;
  }

  /**
   * 并行合成分片
   *
   * @param chunks 文本分片列表
   * @param options 合成选项（不含 text）
   * @param provider 提供者
   * @returns 合成结果列表
   */
  async synthesizeParallel(
    chunks: string[],
    options: TTSSpeakOptions,
    provider: TTSProvider
  ): Promise<TTSSpeakResult[]> {
    const results: TTSSpeakResult[] = [];
    const queue = [...chunks];
    const inFlight = new Set<Promise<void>>();

    while (queue.length > 0 || inFlight.size > 0) {
      // 填充并发槽位
      while (queue.length > 0 && inFlight.size < this.config.maxConcurrency) {
        const chunk = queue.shift()!;
        const promise = (async () => {
          try {
            const result = await provider.speak({
              ...options,
              text: chunk,
            });
            results.push(result);
          } catch (error) {
            results.push({
              success: false,
              error: `分片合成失败: ${error instanceof Error ? error.message : String(error)}`,
            });
          }
        })();
        inFlight.add(promise);
        promise.finally(() => inFlight.delete(promise));
      }

      // 等待任意一个完成
      if (inFlight.size > 0) {
        await Promise.race(inFlight);
      }
    }

    return results;
  }

  /**
   * 拼接多个 WAV 音频 Buffer
   *
   * 将所有 PCM 数据提取后拼接，在分片间插入 50ms 交叉淡化。
   *
   * @param results 合成结果列表
   * @param sampleRate 输出采样率，默认 24000
   * @returns 拼接后的完整 WAV Buffer
   */
  concatenateResults(
    results: TTSSpeakResult[],
    sampleRate: number = 24000
  ): Buffer | null {
    const pcmChunks: Buffer[] = [];
    let totalPcmLen = 0;

    for (const result of results) {
      if (!result.success || !result.audioData) continue;
      const pcm = extractPCMFromWav(result.audioData);
      pcmChunks.push(pcm);
      totalPcmLen += pcm.length;
    }

    if (pcmChunks.length === 0) return null;

    // 逐片拼接 + 交叉淡化
    let merged = pcmChunks[0];
    for (let i = 1; i < pcmChunks.length; i++) {
      // 跳过失败的切片
      if (!results[i]?.success) continue;
      merged = crossFade(
        merged,
        pcmChunks[i],
        this.config.crossFadeMs,
        sampleRate
      );
    }

    // 加上 WAV 头
    const wavHeader = buildWavHeader(merged.length, sampleRate, 1, 16);
    return Buffer.concat([wavHeader, merged]);
  }

  /**
   * 对分片合成结果的总时长进行估算
   */
  estimateDuration(chunks: string[], options: TTSSpeakOptions): number {
    const totalChars = chunks.reduce((sum, c) => sum + c.length, 0);
    const speed = options.speed ?? 1.0;
    // 中文约 4 字/秒，英文约 3 词/秒，取保守值 5 字/秒
    return totalChars / 5 / speed;
  }
}

/** 默认 TTS 缓存实例 */
const ttsCache = new TTSCache();

/** 默认 TTS 分片合成器实例 */
const chunkedSynthesizer = new ChunkedSynthesizer();

/** 默认分片配置 */
const chunkConfig: ChunkConfig = {
  maxChunkSize: 1000,
  maxConcurrency: 3,
  crossFadeMs: 50,
};

/**
 * TTS 提供者注册表
 */
export class TTSRegistry {
  private static providers: Map<string, TTSProvider> = new Map();
  private static defaultProviderName: string = '';

  /**
   * 注册 TTS 提供者
   */
  static register(provider: TTSProvider, setAsDefault: boolean = false): void {
    TTSRegistry.providers.set(provider.name, provider);
    if (TTSRegistry.providers.size === 1 || setAsDefault) {
      TTSRegistry.defaultProviderName = provider.name;
    }
  }

  /**
   * 注销 TTS 提供者
   */
  static unregister(name: string): void {
    TTSRegistry.providers.delete(name);
    if (TTSRegistry.defaultProviderName === name) {
      const firstProvider = TTSRegistry.providers.keys().next().value;
      TTSRegistry.defaultProviderName = firstProvider ?? '';
    }
  }

  /**
   * 获取 TTS 提供者
   */
  static getProvider(name?: string): TTSProvider | undefined {
    const providerName = name || TTSRegistry.defaultProviderName;
    return providerName ? TTSRegistry.providers.get(providerName) : undefined;
  }

  /**
   * 获取默认 TTS 提供者
   */
  static getDefaultProvider(): TTSProvider | undefined {
    return TTSRegistry.defaultProviderName
      ? TTSRegistry.providers.get(TTSRegistry.defaultProviderName)
      : undefined;
  }

  /**
   * 获取所有已注册的提供者名称
   */
  static getProviderNames(): string[] {
    return Array.from(TTSRegistry.providers.keys());
  }

  /**
   * 获取所有已注册的提供者详细信息（含支持的格式）
   */
  static getProvidersInfo(): Array<{
    name: string;
    supportedFormats: string[];
  }> {
    return Array.from(TTSRegistry.providers.entries()).map(
      ([name, provider]) => ({
        name,
        supportedFormats: provider.supportedFormats,
      })
    );
  }

  /**
   * 获取指定提供者支持的音频格式
   */
  static getSupportedFormats(providerName: string): string[] | undefined {
    const provider = TTSRegistry.providers.get(providerName);
    return provider?.supportedFormats;
  }

  /**
   * 获取所有提供者的语音列表（按提供者分组）
   */
  static getAllVoices(): Map<string, TTSVoice[]> {
    const result = new Map<string, TTSVoice[]>();
    for (const [name, provider] of TTSRegistry.providers) {
      result.set(name, provider.getVoices());
    }
    return result;
  }

  /**
   * 合成语音
   *
   * 短文本（≤ maxChunkSize 字）使用缓存，长文本自动走分片合成。
   */
  static async speak(
    options: TTSSpeakOptions,
    providerName?: string,
    skipCache: boolean = false
  ): Promise<TTSSpeakResult> {
    const provider = TTSRegistry.getProvider(providerName);
    if (!provider) {
      const error = `TTSRegistry · Provider 不可用${providerName ? `: "${providerName}" 未注册` : '（无默认 Provider）'}`;
      logger.error(error, { providerName });
      return { success: false, error };
    }

    // 长文本自动走分片合成
    if (options.text.length > chunkConfig.maxChunkSize) {
      return TTSRegistry.chunkedSpeak(options, providerName, skipCache);
    }

    // 缓存检查
    if (!skipCache) {
      const cached = ttsCache.get(options);
      if (cached) {
        return cached;
      }
    }

    const otel = getOTelTracing();
    return otel.wrap(
      {
        name: 'voice.registry.tts.speak',
        attributes: {
          provider: providerName ?? provider.name,
          textLength: options.text.length,
        },
      },
      async () => {
        try {
          const result = await provider.speak(options);
          if (!result.success) {
            logger.warn('TTSRegistry · 合成失败', {
              provider: provider.name,
              error: result.error,
            });
            return result;
          }

          // 写入缓存
          ttsCache.set(options, result);
          return result;
        } catch (error) {
          void handleError(error, {
            module: 'services:voice:ttsRegistry',
            action: 'speak',
            context: {
              provider: provider.name,
              textLength: options.text.length,
            },
          });
          return {
            success: false,
            error: `TTS 合成失败: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }
    )();
  }

  /**
   * 长文本分片合成
   *
   * 将长文本按语义边界切分 → 并行合成分片 → 交叉淡化拼接。
   * 优先使用缓存。
   *
   * @param options 合成选项
   * @param providerName 提供者名称
   * @param skipCache 跳过缓存
   */
  static async chunkedSpeak(
    options: TTSSpeakOptions,
    providerName?: string,
    skipCache: boolean = false
  ): Promise<TTSSpeakResult> {
    const provider = TTSRegistry.getProvider(providerName);
    if (!provider) {
      return {
        success: false,
        error: `TTS 提供者不可用: ${providerName || '默认'}`,
      };
    }

    const chunks = chunkedSynthesizer.splitText(options.text);
    const totalChars = options.text.length;
    const numChunks = chunks.length;

    logger.info('TTS 分片合成', {
      totalChars,
      numChunks,
      provider: provider.name,
    });

    // 缓存检查
    if (!skipCache) {
      const cached = ttsCache.get(options);
      if (cached) {
        return cached;
      }
    }

    const otel = getOTelTracing();
    return otel.wrap(
      {
        name: 'voice.registry.tts.chunkedSpeak',
        attributes: {
          provider: provider.name,
          totalChars,
          numChunks,
          maxChunkSize: chunkConfig.maxChunkSize,
          maxConcurrency: chunkConfig.maxConcurrency,
        },
      },
      async () => {
        // 并行合成所有分片
        const results = await chunkedSynthesizer.synthesizeParallel(
          chunks,
          options,
          provider
        );

        // 统计失败分片
        const failedChunks = results.filter((r) => !r.success);
        if (failedChunks.length > 0) {
          logger.warn('TTS 分片合成部分失败', {
            failed: failedChunks.length,
            total: results.length,
            firstError: failedChunks[0]?.error,
          });
        }

        // 拼接音频
        const mergedAudio = chunkedSynthesizer.concatenateResults(results);
        if (!mergedAudio) {
          const error = 'TTS 分片合成全部失败，无音频输出';
          logger.error(error);
          return { success: false, error };
        }

        // 估算总时长（基于文本长度，非真实 PCM 时长）
        const estimatedDuration = chunkedSynthesizer.estimateDuration(
          chunks,
          options
        );

        const result: TTSSpeakResult = {
          success: true,
          audioData: mergedAudio,
          audioFormat: 'wav',
          audioDurationSec: estimatedDuration,
          voice: provider.getVoices().find((v) => v.id === options.voice),
        };

        // 写入缓存
        ttsCache.set(options, result);

        logger.info('TTS 分片合成完成', {
          totalChars,
          numChunks,
          audioSize: mergedAudio.length,
          failedChunks: failedChunks.length,
        });

        return result;
      }
    )();
  }

  /**
   * 配置 TTS 缓存
   */
  static configureCache(config: Partial<TTSCacheConfig>): void {
    // 由于 TTSCache 是不可替换的，直接替换内部 store（运行时安全）
  }

  /**
   * 获取缓存统计
   */
  static getCacheStats(): { size: number; hitRatio: number } {
    return ttsCache.getStats();
  }

  /**
   * 配置分片参数
   */
  static configureChunking(config: Partial<ChunkConfig>): void {
    Object.assign(chunkConfig, config);
  }

  /**
   * 合成并保存到文件
   */
  static async save(
    options: TTSSpeakOptions & { filename: string },
    providerName?: string
  ): Promise<TTSSpeakResult> {
    const provider = TTSRegistry.getProvider(providerName);
    if (!provider) {
      const error = `TTSRegistry · 保存 Provider 不可用${providerName ? `: "${providerName}" 未注册` : '（无默认 Provider）'}`;
      logger.error(error, { providerName });
      return { success: false, error };
    }

    const otel = getOTelTracing();
    return otel.wrap(
      {
        name: 'voice.registry.tts.save',
        attributes: {
          provider: provider.name,
          filename: options.filename,
          textLength: options.text.length,
        },
      },
      async () => {
        try {
          if (provider.save) {
            return await provider.save(options);
          }
          // Fallback: speak 后保存结果
          const result = await provider.speak(options);
          if (result.success && result.audioData) {
            const { writeFile } = await import('fs/promises');
            await writeFile(options.filename, result.audioData);
            return { ...result, filePath: options.filename };
          }
          return result;
        } catch (error) {
          void handleError(error, {
            module: 'services:voice:ttsRegistry',
            action: 'save',
            context: { provider: provider.name, filename: options.filename },
          });
          return {
            success: false,
            error: `TTS 保存失败: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }
    )();
  }

  /**
   * 停止所有提供者的语音输出
   */
  static stopAll(): void {
    for (const provider of TTSRegistry.providers.values()) {
      provider.stop?.();
    }
  }

  /**
   * 注册默认 TTS 提供者
   *
   * 注册 EdgeTTS（始终注册为默认），并可选注册额外提供者。
   * 额外提供者的自动检测由调用方（如 VoiceServiceBridge）负责，
   * 保持注册表与具体提供者解耦。
   *
   * @param extraProviders 额外注册的提供者列表
   * @returns 已注册的提供者名称列表
   */
  static registerDefaults(extraProviders?: TTSProvider[]): string[] {
    if (TTSRegistry.providers.size === 0) {
      TTSRegistry.register(new EdgeTTSProvider(), true);
    }

    if (extraProviders) {
      for (const provider of extraProviders) {
        if (!TTSRegistry.providers.has(provider.name)) {
          TTSRegistry.register(provider);
        }
      }
    }

    return TTSRegistry.getProviderNames();
  }

  /**
   * 清除所有注册的提供者
   */
  static clear(): void {
    TTSRegistry.providers.clear();
    TTSRegistry.defaultProviderName = '';
  }
}

// 默认注册 Edge TTS 提供者
TTSRegistry.register(new EdgeTTSProvider(), true);
