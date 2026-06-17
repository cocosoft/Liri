/**
 * 国际化（i18n）框架扩展
 * 对标 Hermes locales/ 目录结构
 * 在现有 core/i18n/ 基础上扩展翻译注册和管理能力
 */

import { configManager } from '@modules/config';
import { BUILTIN_TRANSLATIONS } from './extended-translations';

/**
 * 翻译条目
 */
export interface TranslationEntry {
  key: string;
  zh: string;
  en: string;
  ja?: string;
  ko?: string;
  [locale: string]: string | undefined;
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
  registerBatch(entries: TranslationEntry[]): void {
    for (const entry of entries) {
      this.register(entry);
    }
  }

  /**
   * 翻译键值
   * @param key 翻译键
   * @param params 参数替换
   * @param locale 指定地区
   * @returns 翻译后的文本
   */
  t(
    key: string,
    params?: Record<string, string | number>,
    locale?: SupportedLocale
  ): string {
    const entry = this.translations.get(key);
    const targetLocale = locale || this.currentLocale;

    let text: string | undefined;

    if (entry) {
      text = entry[targetLocale];

      if (!text) {
        text = entry[this.fallbackLocale];
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
        text = text.replace(`{${paramKey}}`, String(paramValue));
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
        if (key !== 'key' && entry[key]) {
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
        entry[targetLocale] ||
        entry[this.fallbackLocale] ||
        entry.zh ||
        entry.en ||
        key;
    }

    return result;
  }

  /**
   * 清除所有翻译
   */
  clear(): void {
    this.translations.clear();
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
  key: string,
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
