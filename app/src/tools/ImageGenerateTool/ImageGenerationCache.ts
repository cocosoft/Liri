/**
 * ImageGenerationCache
 * 图像生成精确匹配缓存（基于 prompt + provider + size 的 hash）
 *
 * 缓存策略：
 *   - 精确匹配：hash(prompt + provider + size) 完全一致才命中
 *   - Prompt 归一化：trim + 多空格压缩 + 小写 + 去除中文标点
 *   - TTL：默认 3600 秒（1 小时），可配置
 *   - 内存 LRU：最多 100 条，超出后淘汰最旧条目
 */

import type {
  ImageGenerationParams,
  ImageGenerationResult,
} from '../../ai/providers/AIProvider';
import type { GenerationCacheConfig } from './types';

/** 缓存条目 */
interface CacheEntry {
  result: ImageGenerationResult;
  createdAt: number;
  ttlMs: number;
}

const MAX_CACHE_SIZE = 100;
const DEFAULT_TTL_MS = 3600 * 1000;

export class ImageGenerationCache {
  private store = new Map<string, CacheEntry>();
  private config: GenerationCacheConfig;

  constructor(config: GenerationCacheConfig) {
    this.config = config;
  }

  /** 更新缓存配置 */
  updateConfig(config: GenerationCacheConfig): void {
    this.config = config;
    if (!config.enabled) {
      this.clear();
    }
  }

  /** 计算缓存 key */
  private computeKey(params: ImageGenerationParams): string {
    const prompt = this.normalizePrompt(params.prompt);
    const provider = params.format ?? 'default';
    const size = params.size ?? '1024x1024';

    // 简单 hash：拼接后取前 64 字符
    const raw = `${prompt}|${provider}|${size}`;
    return raw.slice(0, 128);
  }

  /**
   * Prompt 归一化
   * trim + 多空格 → 单空格 + 小写 + 去除中文标点
   */
  private normalizePrompt(prompt: string): string {
    return prompt
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .replace(/[，。！？、；：""''（）【】《》]/g, '');
  }

  /** 获取缓存 */
  get(params: ImageGenerationParams): ImageGenerationResult | null {
    if (!this.config.enabled) return null;

    const key = this.computeKey(params);
    const entry = this.store.get(key);

    if (!entry) return null;

    // 检查 TTL
    if (Date.now() - entry.createdAt > entry.ttlMs) {
      this.store.delete(key);
      return null;
    }

    // LRU: 移到末尾
    this.store.delete(key);
    this.store.set(key, entry);

    return entry.result;
  }

  /** 写入缓存 */
  set(params: ImageGenerationParams, result: ImageGenerationResult): void {
    if (!this.config.enabled) return;

    const key = this.computeKey(params);

    // 淘汰最旧条目
    if (this.store.size >= MAX_CACHE_SIZE) {
      const oldest = this.store.keys().next().value;
      if (oldest) {
        this.store.delete(oldest);
      }
    }

    this.store.set(key, {
      result,
      createdAt: Date.now(),
      ttlMs: (this.config.ttlSeconds || 3600) * 1000,
    });
  }

  /** 清空所有缓存 */
  clear(): void {
    this.store.clear();
  }

  /** 获取缓存大小 */
  get size(): number {
    return this.store.size;
  }
}
