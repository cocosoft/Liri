/**
 * 国际化（i18n）框架扩展
 * 对标 Hermes locales/ 目录结构
 * 在现有 core/i18n/ 基础上扩展翻译注册和管理能力
 */

import { configManager } from '@modules/config';
import { BUILTIN_TRANSLATIONS } from './extended-translations';

/**
 * 翻译键类型 — 从内置翻译数据自动推导，提供编译期类型检查
 */
export type TranslationKey = (typeof BUILTIN_TRANSLATIONS)[number]['key'];

/**
 * 翻译条目
 */
export interface TranslationEntry {
  key: string;
  zh: string;
  en: string;
  ja?: string;
  ko?: string;
  /** 可见性：internal 仅模块内使用，public 跨模块 */
  scope?: 'internal' | 'public';
  /** 用途说明 */
  description?: string;
  /** 废弃标记 */
  deprecated?: boolean;
  /** 引入版本 */
  since?: string;
  [locale: string]: string | boolean | undefined;
}

/**
 * AI 翻译器接口
 *
 * 用于在翻译缺失时自动调用 AI 补全翻译。
 */
export interface AITranslator {
  translate(
    text: string,
    sourceLang: string,
    targetLang: string
  ): Promise<string>;
}

/**
 * 支持的 locale
 */
export type SupportedLocale = 'zh' | 'en' | 'ja' | 'ko';

/**
 * 检测系统语言环境
 * 优先级: 环境变量 > Intl API > 默认中文
 * @returns 检测到的 locale
 */
export function detectSystemLocale(): SupportedLocale {
  const envLocale =
    configManager.env('LANG') ||
    configManager.env('LC_ALL') ||
    configManager.env('LC_MESSAGES');

  if (envLocale) {
    const normalized = envLocale.toLowerCase();
    if (normalized.includes('ja')) return 'ja';
    if (normalized.includes('ko')) return 'ko';
    if (normalized.includes('en') || normalized.includes('us')) return 'en';
    if (normalized.includes('zh') || normalized.includes('cn')) return 'zh';
  }

  try {
    const intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (intlLocale.startsWith('zh')) return 'zh';
    if (intlLocale.startsWith('en')) return 'en';
    if (intlLocale.startsWith('ja')) return 'ja';
    if (intlLocale.startsWith('ko')) return 'ko';
  } catch {
    // Intl API 不可用时静默降级
  }

  return 'zh';
}

/**
 * 翻译注册表扩展
 */
export class I18nTranslationRegistry {
  private translations: Map<string, TranslationEntry> = new Map();
  private fallbackLocale: SupportedLocale = 'zh';
  private currentLocale: SupportedLocale = detectSystemLocale();

  /** AI 翻译器（可选注册，用于缺失翻译自动补全） */
  private aiTranslator: AITranslator | null = null;

  /** AI 翻译缓存：key:locale → 翻译结果 */
  private translationCache: Map<string, string> = new Map();

  /** 异步 locale 加载器 */
  private loaders: Map<string, () => Promise<TranslationEntry[]>> = new Map();

  /** 已加载的 locale */
  private loadedLocales: Set<string> = new Set();

  /**
   * 从翻译条目中安全读取 locale 文本
   * @param entry 翻译条目
   * @param locale locale 代码
   * @returns 翻译文本或 undefined
   */
  private getText(entry: TranslationEntry, locale: string): string | undefined {
    const value = entry[locale];
    return typeof value === 'string' ? value : undefined;
  }

  /**
   * 设置当前 locale
   * @param locale 地区
   */
  setLocale(locale: SupportedLocale): void {
    this.currentLocale = locale;
  }

  /**
   * 获取当前 locale
   */
  getLocale(): SupportedLocale {
    return this.currentLocale;
  }

  /**
   * 设置回退 locale
   * @param locale 地区
   */
  setFallbackLocale(locale: SupportedLocale): void {
    this.fallbackLocale = locale;
  }

  /**
   * 注册翻译条目
   * @param entry 翻译条目
   */
  register(entry: TranslationEntry): void {
    this.translations.set(entry.key, entry);
  }

  /**
   * 批量注册翻译条目
   * @param entries 翻译条目列表
   */
  registerBatch(entries: readonly TranslationEntry[]): void {
    for (const entry of entries) {
      this.register(entry);
    }
  }

  /**
   * 翻译键值
   * @param key 翻译键
   * @param params 参数替换
   * @param locale 指定地区
   * @returns 翻译后的文本，未找到时返回 key 本身
   */
  t(
    key: TranslationKey | string,
    params?: Record<string, string | number>,
    locale?: SupportedLocale
  ): string {
    const entry = this.translations.get(key);
    const targetLocale = locale || this.currentLocale;

    let text: string | undefined;

    if (entry) {
      text = this.getText(entry, targetLocale);

      if (!text) {
        text = this.getText(entry, this.fallbackLocale);
      }

      if (!text) {
        text = entry.zh || entry.en;
      }
    }

    if (!text) {
      return key;
    }

    if (params) {
      for (const [paramKey, paramValue] of Object.entries(params)) {
        text = text.replace(
          new RegExp(`\\{${paramKey}\\}`, 'g'),
          String(paramValue)
        );
      }
    }

    return text;
  }

  /**
   * 异步翻译键值（支持 AI 翻译器回退）
   *
   * 优先从注册表查找翻译；未命中时若已注册 AI 翻译器，则调用 AI 补全并缓存结果。
   * @param key 翻译键
   * @param params 参数替换
   * @param locale 指定地区
   * @returns 翻译后的文本
   */
  async tAsync(
    key: string,
    params?: Record<string, string | number>,
    locale?: SupportedLocale
  ): Promise<string> {
    const targetLocale = locale || this.currentLocale;

    // 先尝试同步查找
    const entry = this.translations.get(key);
    let text: string | undefined;

    if (entry) {
      text =
        this.getText(entry, targetLocale) ||
        this.getText(entry, this.fallbackLocale) ||
        entry.zh ||
        entry.en;
    }

    if (!text) {
      // 检查 AI 翻译缓存
      const cacheKey = `${key}:${targetLocale}`;
      const cached = this.translationCache.get(cacheKey);
      if (cached) {
        text = cached;
      } else if (this.aiTranslator) {
        // 调用 AI 翻译并缓存
        try {
          text = await this.aiTranslator.translate(
            key,
            this.fallbackLocale,
            targetLocale
          );
          this.translationCache.set(cacheKey, text);
        } catch {
          // AI 翻译失败时降级返回 key
          return key;
        }
      }
    }

    if (!text) {
      return key;
    }

    if (params) {
      for (const [paramKey, paramValue] of Object.entries(params)) {
        text = text.replace(
          new RegExp(`\\{${paramKey}\\}`, 'g'),
          String(paramValue)
        );
      }
    }

    return text;
  }

  /**
   * 获取所有翻译键
   * @returns 键列表
   */
  getKeys(): string[] {
    return Array.from(this.translations.keys());
  }

  /**
   * 获取所有翻译条目
   * @returns 条目列表
   */
  getAll(): TranslationEntry[] {
    return Array.from(this.translations.values());
  }

  /**
   * 获取翻译统计
   */
  getStats(): { total: number; languages: string[] } {
    const langs = new Set<string>();

    for (const entry of this.translations.values()) {
      for (const key of Object.keys(entry)) {
        if (key !== 'key' && typeof entry[key] === 'string' && entry[key]) {
          langs.add(key);
        }
      }
    }

    return {
      total: this.translations.size,
      languages: Array.from(langs),
    };
  }

  /**
   * 翻译覆盖率检查
   * 检查所有 locale 中每个 key 的翻译完整度，报告缺失项
   * @returns 覆盖率报告
   */
  checkCoverage(): {
    totalKeys: number;
    locales: string[];
    missingByLocale: Record<string, string[]>;
    completeness: Record<string, number>;
    allComplete: boolean;
  } {
    const allLocales = new Set<string>();
    const allKeys = new Set<string>();

    for (const entry of this.translations.values()) {
      allKeys.add(entry.key);
      for (const k of Object.keys(entry)) {
        if (k !== 'key' && typeof entry[k] === 'string' && entry[k]) {
          allLocales.add(k);
        }
      }
    }

    const localeList = Array.from(allLocales).sort();
    const missingByLocale: Record<string, string[]> = {};

    for (const locale of localeList) {
      const missing: string[] = [];
      for (const entry of this.translations.values()) {
        if (!this.getText(entry, locale)) {
          missing.push(entry.key);
        }
      }
      if (missing.length > 0) {
        missingByLocale[locale] = missing;
      }
    }

    const totalKeys = allKeys.size;
    const completeness: Record<string, number> = {};
    for (const locale of localeList) {
      const missing = missingByLocale[locale]?.length ?? 0;
      completeness[locale] =
        totalKeys > 0
          ? Math.round(((totalKeys - missing) / totalKeys) * 10000) / 100
          : 100;
    }

    return {
      totalKeys,
      locales: localeList,
      missingByLocale,
      completeness,
      allComplete: Object.keys(missingByLocale).length === 0,
    };
  }

  /**
   * 从 JSON 加载翻译
   * @param json JSON 数据
   */
  loadFromJSON(json: Record<string, Record<string, string>>): void {
    for (const [key, localeMap] of Object.entries(json)) {
      this.register({
        key,
        ...localeMap,
      } as TranslationEntry);
    }
  }

  /**
   * 导出为 JSON
   * @param locale 地区
   * @returns JSON 对象
   */
  exportAsJSON(locale?: SupportedLocale): Record<string, string> {
    const targetLocale = locale || this.currentLocale;
    const result: Record<string, string> = {};

    for (const [key, entry] of this.translations) {
      result[key] =
        this.getText(entry, targetLocale) ||
        this.getText(entry, this.fallbackLocale) ||
        entry.zh ||
        entry.en ||
        key;
    }

    return result;
  }

  /**
   * 注册 AI 翻译器，用于缺失翻译时的自动补全
   * @param translator AI 翻译器实例
   */
  registerAITranslator(translator: AITranslator): void {
    this.aiTranslator = translator;
  }

  /**
   * 获取 AI 翻译缓存（可用于导出翻译记忆）
   * @returns 缓存映射 key:locale → 翻译结果
   */
  getTranslationCache(): Map<string, string> {
    return new Map(this.translationCache);
  }

  /**
   * 按 scope 过滤翻译条目
   * @param scope 可见性
   * @returns 符合条件的条目列表
   */
  getByScope(scope: 'internal' | 'public'): TranslationEntry[] {
    const result: TranslationEntry[] = [];
    for (const entry of this.translations.values()) {
      if (entry.scope === scope) {
        result.push(entry);
      }
    }
    return result;
  }

  /**
   * 获取所有已标记为废弃的 key
   * @returns 废弃 key 列表
   */
  getDeprecated(): TranslationEntry[] {
    const result: TranslationEntry[] = [];
    for (const entry of this.translations.values()) {
      if (entry.deprecated) {
        result.push(entry);
      }
    }
    return result;
  }

  /**
   * 注册异步 locale 加载器
   *
   * 当切换到的 locale 有对应 loader 且未加载时，自动触发加载。
   * @param locale locale 代码
   * @param loader 加载函数，返回 `TranslationEntry[]`
   */
  registerLoader(
    locale: string,
    loader: () => Promise<TranslationEntry[]>
  ): void {
    this.loaders.set(locale, loader);
  }

  /**
   * 预加载指定 locale 的翻译
   * @param locale locale 代码
   */
  async preload(locale: string): Promise<void> {
    if (this.loadedLocales.has(locale)) return;

    const loader = this.loaders.get(locale);
    if (loader) {
      const entries = await loader();
      this.registerBatch(entries);
    }
    this.loadedLocales.add(locale);
  }

  /**
   * 切换当前 locale（自动触发预加载）
   * @param locale 目标 locale
   */
  async switchLocale(locale: SupportedLocale): Promise<void> {
    this.currentLocale = locale;
    await this.preload(locale);
  }

  /**
   * 清除所有翻译
   */
  clear(): void {
    this.translations.clear();
    this.translationCache.clear();
    this.loadedLocales.clear();
  }
}

/**
 * 全局翻译注册表
 */
let globalI18nRegistry: I18nTranslationRegistry | null = null;

/**
 * 获取全局 i18n 翻译注册表
 */
export function getI18nTranslationRegistry(): I18nTranslationRegistry {
  if (!globalI18nRegistry) {
    globalI18nRegistry = new I18nTranslationRegistry();
  }

  return globalI18nRegistry;
}

/**
 * 快捷翻译函数
 * @param key 翻译键
 * @param params 参数
 * @returns 翻译文本
 */
export function t(
  key: TranslationKey | string,
  params?: Record<string, string | number>
): string {
  return getI18nTranslationRegistry().t(key, params);
}

/**
 * 初始化内置翻译
 * @param registry 注册表实例
 */
export function initializeBuiltinTranslations(
  registry: I18nTranslationRegistry
): void {
  registry.registerBatch(BUILTIN_TRANSLATIONS);
}
