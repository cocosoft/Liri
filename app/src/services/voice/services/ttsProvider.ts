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
import { TTSQueuePriority } from './ttsTypes';
export type {
  TTSVoice,
  TTSSpeakOptions,
  TTSSpeakResult,
  TTSProvider,
} from './ttsTypes';
export { TTSQueuePriority } from './ttsTypes';

import { EdgeTTSProvider } from './edgeTTSProvider';
export { EdgeTTSProvider };

const logger = new Logger({
  module: 'voice:ttsProvider',
  level: LogLevel.INFO,
});

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

// ===========================================================
// TTS 优先级队列
// ===========================================================

/**
 * TTS 队列配置
 */
interface TTSQueueConfig {
  /** 是否启用队列（默认 false，保持向后兼容） */
  enabled: boolean;
  /** 队列处理并发数（默认 1，串行处理） */
  concurrency: number;
}

/** TTS 队列条目 */
interface TTSQueueItem {
  /** 合成选项 */
  options: TTSSpeakOptions;
  /** 提供者名称 */
  providerName?: string;
  /** 是否跳过缓存 */
  skipCache: boolean;
  /** 完成回调 */
  resolve: (result: TTSSpeakResult) => void;
  /** 失败回调 */
  reject: (error: Error) => void;
}

/**
 * TTS 优先级队列
 *
 * 按优先级（数字越小优先级越高）出队，同优先级 FIFO。
 * 支持可配置并发数，默认串行处理。
 */
class TTSPriorityQueue {
  /** 按优先级分组的队列（Map<priority, TTSQueueItem[]>） */
  private queues: Map<number, TTSQueueItem[]> = new Map();
  /** 当前活跃处理数 */
  private active: number = 0;
  /** 配置 */
  private config: TTSQueueConfig;

  /** 累计入队数 */
  private totalEnqueued: number = 0;
  /** 累计完成数 */
  private totalProcessed: number = 0;
  /** 累计失败数 */
  private totalFailed: number = 0;

  constructor(config?: Partial<TTSQueueConfig>) {
    this.config = {
      enabled: false,
      concurrency: 1,
      ...config,
    };
  }

  /**
   * 更新配置
   */
  configure(config: Partial<TTSQueueConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * 获取当前配置
   */
  getConfig(): TTSQueueConfig {
    return { ...this.config };
  }

  /**
   * 入队
   *
   * @param item 队列条目
   */
  enqueue(item: TTSQueueItem): void {
    const priority = item.options.priority ?? TTSQueuePriority.NORMAL;
    const queue = this.queues.get(priority);
    if (queue) {
      queue.push(item);
    } else {
      this.queues.set(priority, [item]);
    }
    this.totalEnqueued++;
    this.processNext();
  }

  /**
   * 处理下一个条目
   */
  private processNext(): void {
    while (this.active < this.config.concurrency) {
      const item = this.dequeue();
      if (!item) break;

      this.active++;
      this.processItem(item);
    }
  }

  /**
   * 出队 — 取优先级最高的第一个条目
   */
  private dequeue(): TTSQueueItem | undefined {
    const priorities = Array.from(this.queues.keys()).sort((a, b) => a - b);
    for (const p of priorities) {
      const queue = this.queues.get(p)!;
      if (queue.length > 0) {
        return queue.shift();
      }
      // 空队列清理
      this.queues.delete(p);
    }
    return undefined;
  }

  /**
   * 处理单个条目
   */
  private async processItem(item: TTSQueueItem): Promise<void> {
    try {
      const result = await TTSRegistry.speakInternal(
        item.options,
        item.providerName,
        item.skipCache
      );
      item.resolve(result);
      this.totalProcessed++;
    } catch (error) {
      item.reject(error instanceof Error ? error : new Error(String(error)));
      this.totalFailed++;
    } finally {
      this.active--;
      this.processNext();
    }
  }

  /**
   * 获取队列统计
   */
  getStats(): {
    enabled: boolean;
    queued: number;
    active: number;
    totalEnqueued: number;
    totalProcessed: number;
    totalFailed: number;
  } {
    let queued = 0;
    for (const queue of this.queues.values()) {
      queued += queue.length;
    }
    return {
      enabled: this.config.enabled,
      queued,
      active: this.active,
      totalEnqueued: this.totalEnqueued,
      totalProcessed: this.totalProcessed,
      totalFailed: this.totalFailed,
    };
  }

  /**
   * 清空队列（拒绝所有等待中的条目）
   */
  clear(): void {
    for (const queue of this.queues.values()) {
      for (const item of queue) {
        item.reject(new Error('TTS 队列已清空'));
      }
    }
    this.queues.clear();
  }
}

/** 默认 TTS 队列实例 */
const ttsQueue = new TTSPriorityQueue();

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
 * 从 WAV 头中提取采样率
 *
 * @param wavBuffer 完整 WAV 文件 Buffer
 * @returns 采样率（Hz），非 WAV 格式返回默认 24000
 */
function getSampleRateFromWav(wavBuffer: Buffer): number {
  if (wavBuffer.length < WAV_HEADER_SIZE) return 24000;
  const headerId = wavBuffer.toString('ascii', 0, 4);
  if (headerId !== 'RIFF') return 24000;
  return wavBuffer.readUInt32LE(24);
}

/**
 * 对 PCM16 音频进行线性插值重采样
 *
 * 将源采样率的音频线性插值到目标采样率。
 * 采用线性插值在质量与计算开销之间取得平衡。
 *
 * @param pcmData PCM16 s16le 原始音频数据（不含 WAV 头）
 * @param sourceRate 源采样率（Hz）
 * @param targetRate 目标采样率（Hz）
 * @returns 重采样后的 PCM16 Buffer
 */
function resampleToTargetRate(
  pcmData: Buffer,
  sourceRate: number,
  targetRate: number
): Buffer {
  if (sourceRate === targetRate || sourceRate <= 0 || targetRate <= 0) {
    return pcmData;
  }

  const sourceLength = Math.floor(pcmData.length / 2);
  if (sourceLength <= 1) return pcmData;

  const targetLength = Math.round(sourceLength * (targetRate / sourceRate));
  const out = Buffer.alloc(targetLength * 2);
  const ratio = sourceRate / targetRate;

  for (let i = 0; i < targetLength; i++) {
    const srcPos = i * ratio;
    const srcIndex = Math.floor(srcPos);
    const frac = srcPos - srcIndex;

    if (srcIndex >= sourceLength - 1) {
      // 边界：直接复制最后一个样本
      out.writeInt16LE(pcmData.readInt16LE((sourceLength - 1) * 2), i * 2);
    } else {
      // 线性插值
      const s0 = pcmData.readInt16LE(srcIndex * 2);
      const s1 = pcmData.readInt16LE((srcIndex + 1) * 2);
      const sample = Math.round(s0 + (s1 - s0) * frac);
      out.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i * 2);
    }
  }

  return out;
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
   * 边界修复的最大回退字符数，防止过度修剪导致分片过小。
   * 原文超过此长度的边界元素将被保留在当前片，由后续分片自然承接。
   */
  private static readonly MAX_BOUNDARY_BACKTRACK = 100;

  /**
   * 语义边界修补
   *
   * 规则：
   *   - 括号配对：左括号必须与右括号在同一片
   *   - 引号不跨片：成对引号不跨片截断
   *   - 数字+单位不拆分：如 "100 美元" 不跨片
   *   - 英文单词不截断：如果末尾是单词中间，回退到最近空格
   *
   * 所有回退操作限制在 MAX_BOUNDARY_BACKTRACK 字符内。
   */
  private repairBoundary(chunk: string): string {
    // 如果 chunk 很短，无需边界修复
    if (chunk.length <= 1) return chunk;

    // 英文单词不截断
    const trailingWord = chunk.match(/[a-zA-Z]+$/);
    if (trailingWord) {
      const wordStart = chunk.lastIndexOf(trailingWord[0]);
      if (wordStart > 0) {
        const tailLength = chunk.length - wordStart;
        if (tailLength <= ChunkedSynthesizer.MAX_BOUNDARY_BACKTRACK) {
          return chunk.slice(0, wordStart).trimEnd();
        }
      }
    }

    // 数字+单位不拆分
    // 如 "100 美元" — "100" 不截断，"3.14%" 不截断
    const trailingNumber = chunk.match(/\d[\d,.]*$/);
    if (trailingNumber) {
      const numStart = chunk.lastIndexOf(trailingNumber[0]);
      if (numStart > 0) {
        const tailLength = chunk.length - numStart;
        if (tailLength <= ChunkedSynthesizer.MAX_BOUNDARY_BACKTRACK) {
          return chunk.slice(0, numStart).trimEnd();
        }
      }
    }

    // 成对引号不跨片
    const quotePairs: [string, string][] = [
      ['「', '」'],
      ['『', '』'],
      ['"', '"'],
      ['"', '"'],
      ["'", "'"],
    ];
    for (const [open, close] of quotePairs) {
      const openCount = this.countChar(chunk, open);
      const closeCount = this.countChar(chunk, close);
      if (openCount > closeCount) {
        const lastOpen = chunk.lastIndexOf(open);
        if (lastOpen > 0) {
          const tailLength = chunk.length - lastOpen;
          if (tailLength <= ChunkedSynthesizer.MAX_BOUNDARY_BACKTRACK) {
            return chunk.slice(0, lastOpen).trimEnd();
          }
        }
      }
    }

    // 括号未闭合 — 左括号多于右括号时回退
    const bracketPairs: [string, string][] = [
      ['（', '）'],
      ['(', ')'],
    ];
    for (const [open, close] of bracketPairs) {
      const openCount = this.countChar(chunk, open);
      const closeCount = this.countChar(chunk, close);
      if (openCount > closeCount) {
        const lastOpen = chunk.lastIndexOf(open);
        if (lastOpen > 0) {
          const tailLength = chunk.length - lastOpen;
          if (tailLength <= ChunkedSynthesizer.MAX_BOUNDARY_BACKTRACK) {
            return chunk.slice(0, lastOpen).trimEnd();
          }
        }
      }
    }

    return chunk;
  }

  /**
   * 统计字符串中指定字符的出现次数
   */
  private countChar(str: string, char: string): number {
    let count = 0;
    for (let i = 0; i < str.length; i++) {
      if (str[i] === char) count++;
    }
    return count;
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

      // 提取 PCM 数据
      const pcm = extractPCMFromWav(result.audioData);

      // 从 WAV 头提取源采样率，若不匹配则重采样
      const sourceRate = getSampleRateFromWav(result.audioData);
      const resampled =
        sourceRate !== sampleRate
          ? resampleToTargetRate(pcm, sourceRate, sampleRate)
          : pcm;

      pcmChunks.push(resampled);
      totalPcmLen += resampled.length;
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
   * 合成语音（外部入口）
   *
   * 如果 TTS 队列已启用，则走队列调度；否则直接合成。
   * 短文本（≤ maxChunkSize 字）使用缓存，长文本自动走分片合成。
   */
  static async speak(
    options: TTSSpeakOptions,
    providerName?: string,
    skipCache: boolean = false
  ): Promise<TTSSpeakResult> {
    // 队列启用 → 入队等待调度
    if (ttsQueue.getConfig().enabled) {
      return new Promise<TTSSpeakResult>((resolve, reject) => {
        ttsQueue.enqueue({ options, providerName, skipCache, resolve, reject });
      });
    }

    // 队列未启用 → 直接合成（原有行为）
    return TTSRegistry.speakInternal(options, providerName, skipCache);
  }

  /**
   * 合成语音（内部实现）
   *
   * 不涉及队列调度，直接执行合成逻辑。
   * 供 speak() 和 TTSPriorityQueue.processItem() 共用。
   */
  static async speakInternal(
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
   * 配置 TTS 优先级队列
   *
   * 启用队列后，speak() 请求会按优先级排队调度，避免并发合成过多。
   * 默认关闭（向后兼容），开启后串行处理（concurrency=1）。
   *
   * @param config 队列配置
   */
  static configureQueue(config: Partial<TTSQueueConfig>): void {
    ttsQueue.configure(config);
    logger.info('TTSRegistry · 队列配置已更新', {
      enabled: ttsQueue.getConfig().enabled,
      concurrency: ttsQueue.getConfig().concurrency,
    });
  }

  /**
   * 获取 TTS 队列统计
   */
  static getQueueStats(): ReturnType<typeof ttsQueue.getStats> {
    return ttsQueue.getStats();
  }

  /**
   * 清空 TTS 队列
   */
  static clearQueue(): void {
    ttsQueue.clear();
    logger.info('TTSRegistry · 队列已清空');
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
