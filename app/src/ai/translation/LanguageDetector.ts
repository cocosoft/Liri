/**
 * MIT License
 * Copyright (c) 2026 Liri
 *
 * 语言检测器
 *
 * 使用 Unicode 字符范围 + 常见词匹配进行语言检测。
 * 不依赖外部 API，零网络开销。
 */

import type { LanguageCode, LanguageDetectionResult } from './types';

/** 语言检测器配置 */
export interface LanguageDetectorConfig {
  confidenceThreshold?: number;
}

/** Unicode 字符范围定义 */
const CJK_UNIFIED = /[\u4E00-\u9FFF]/;
const HIRAGANA = /[\u3040-\u309F]/;
const KATAKANA = /[\u30A0-\u30FF]/;
const HANGUL = /[\uAC00-\uD7AF]/;
const CYRILLIC = /[\u0400-\u04FF]/;
const ARABIC = /[\u0600-\u06FF]/;
const THAI = /[\u0E00-\u0E7F]/;
const LATIN = /[a-zA-Z]/;

/** 中文常见词（用于区分 zh 和 ja） */
const CHINESE_COMMON =
  /[的是不了一我人]|什么|怎么|这个|那个|因为|所以|可以|但是/;

/** 检测缓存 TTL（5 分钟） */
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  result: LanguageDetectionResult;
  expiresAt: number;
}

export class LanguageDetector {
  private config: Required<LanguageDetectorConfig>;
  private cache: Map<string, CacheEntry> = new Map();

  constructor(config: LanguageDetectorConfig = {}) {
    this.config = { confidenceThreshold: config.confidenceThreshold ?? 0.3 };
  }

  /**
   * 检测文本语言（带 5 分钟 TTL 缓存）
   */
  detect(text: string): LanguageDetectionResult {
    if (!text || !text.trim()) {
      return { detectedLanguage: 'unknown', confidence: 0, autoDetected: true };
    }

    const cacheKey = this.getCacheKey(text);
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    // 清理过期缓存
    if (this.cache.size > 200) {
      this.evictExpired();
    }

    const result = this.doDetect(text);
    this.cache.set(cacheKey, {
      result,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return result;
  }

  /**
   * 实际检测逻辑
   */
  private doDetect(text: string): LanguageDetectionResult {
    const totalChars = text.length;
    let cjkCount = 0;
    let hiraganaCount = 0;
    let katakanaCount = 0;
    let hangulCount = 0;
    let cyrillicCount = 0;
    let arabicCount = 0;
    let thaiCount = 0;
    let latinCount = 0;

    for (const ch of text) {
      if (CJK_UNIFIED.test(ch)) cjkCount++;
      if (HIRAGANA.test(ch)) hiraganaCount++;
      if (KATAKANA.test(ch)) katakanaCount++;
      if (HANGUL.test(ch)) hangulCount++;
      if (CYRILLIC.test(ch)) cyrillicCount++;
      if (ARABIC.test(ch)) arabicCount++;
      if (THAI.test(ch)) thaiCount++;
      if (LATIN.test(ch)) latinCount++;
    }

    const cjkRatio = cjkCount / totalChars;
    const hangulRatio = hangulCount / totalChars;
    const cyrillicRatio = cyrillicCount / totalChars;
    const arabicRatio = arabicCount / totalChars;
    const thaiRatio = thaiCount / totalChars;
    const latinRatio = latinCount / totalChars;

    // 韩语：Hangul 占比高
    if (hangulRatio > this.config.confidenceThreshold) {
      return {
        detectedLanguage: 'ko',
        confidence: hangulRatio,
        autoDetected: true,
      };
    }

    // 俄语：Cyrillic 占比高
    if (cyrillicRatio > this.config.confidenceThreshold) {
      return {
        detectedLanguage: 'ru',
        confidence: cyrillicRatio,
        autoDetected: true,
      };
    }

    // 阿拉伯语
    if (arabicRatio > this.config.confidenceThreshold) {
      return {
        detectedLanguage: 'ar',
        confidence: arabicRatio,
        autoDetected: true,
      };
    }

    // 泰语
    if (thaiRatio > this.config.confidenceThreshold) {
      return {
        detectedLanguage: 'th',
        confidence: thaiRatio,
        autoDetected: true,
      };
    }

    // CJK 语言：区分中文和日文
    if (cjkRatio > this.config.confidenceThreshold) {
      const kanaRatio = (hiraganaCount + katakanaCount) / totalChars;
      if (kanaRatio > 0.05) {
        return {
          detectedLanguage: 'ja',
          confidence: cjkRatio,
          autoDetected: true,
        };
      }
      return {
        detectedLanguage: 'zh',
        confidence: cjkRatio,
        autoDetected: true,
      };
    }

    // 拉丁语系：检测中文常见词
    if (CHINESE_COMMON.test(text)) {
      return { detectedLanguage: 'zh', confidence: 0.5, autoDetected: true };
    }

    // 拉丁语系：默认返回英文
    if (latinRatio > this.config.confidenceThreshold) {
      return {
        detectedLanguage: 'en',
        confidence: latinRatio,
        autoDetected: true,
      };
    }

    return { detectedLanguage: 'unknown', confidence: 0, autoDetected: true };
  }

  /**
   * 解析源语言：若 sourceLang 为 'auto' 则执行检测，否则直接返回
   */
  resolveSourceLang(
    text: string,
    sourceLang: LanguageCode
  ): LanguageDetectionResult {
    if (sourceLang === 'auto' || !sourceLang) {
      return this.detect(text);
    }
    return { detectedLanguage: sourceLang, confidence: 1, autoDetected: false };
  }

  /** 生成缓存 key（短文本直接用原文，长文本取前 100 字 + 长度 hash） */
  private getCacheKey(text: string): string {
    if (text.length <= 200) return text;
    return text.substring(0, 100) + '_' + text.length;
  }

  /** 清理过期缓存条目 */
  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }
}
