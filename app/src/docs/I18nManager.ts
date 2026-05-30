/**
 * 国际化管理器
 * 提供多语言支持和本地化功能
 */

import { LanguagePack } from './types.js';
import { logger } from '../utils/log.js';

/**
 * 默认中文语言包
 */
const DEFAULT_ZH_PACK: LanguagePack = {
  code: 'zh',
  name: '中文',
  translations: {
    'app.name': 'Liri',
    'app.description': '智能助手',
    'command.help': '显示帮助信息',
    'command.exit': '退出应用',
    'error.unknown': '未知错误',
    'error.config_not_found': '配置文件未找到',
    'error.permission_denied': '权限不足',
    'success.saved': '保存成功',
    'success.loaded': '加载成功',
    'prompt.input': '请输入',
    'prompt.confirm': '确认',
    'prompt.cancel': '取消',
  },
};

/**
 * 默认英文语言包
 */
const DEFAULT_EN_PACK: LanguagePack = {
  code: 'en',
  name: 'English',
  translations: {
    'app.name': 'Liri',
    'app.description': 'Intelligent Programming Assistant',
    'command.help': 'Show help information',
    'command.exit': 'Exit application',
    'error.unknown': 'Unknown error',
    'error.config_not_found': 'Configuration file not found',
    'error.permission_denied': 'Permission denied',
    'success.saved': 'Saved successfully',
    'success.loaded': 'Loaded successfully',
    'prompt.input': 'Please input',
    'prompt.confirm': 'Confirm',
    'prompt.cancel': 'Cancel',
  },
};

/**
 * 国际化管理器类
 */
export class I18nManager {
  private languagePacks: Map<string, LanguagePack> = new Map();
  private currentLanguage: string = 'zh';
  private fallbackLanguage: string = 'zh';

  /**
   * 构造函数
   */
  constructor() {
    // 加载默认语言包
    this.registerLanguagePack(DEFAULT_ZH_PACK);
    this.registerLanguagePack(DEFAULT_EN_PACK);
  }

  /**
   * 注册语言包
   * @param pack 语言包
   */
  registerLanguagePack(pack: LanguagePack): void {
    this.languagePacks.set(pack.code, pack);
  }

  /**
   * 设置当前语言
   * @param language 语言代码
   */
  setLanguage(language: string): void {
    if (!this.languagePacks.has(language)) {
      logger.warn(`语言包 ${language} 不存在，使用默认语言`);
      return;
    }
    this.currentLanguage = language;
  }

  /**
   * 获取当前语言
   * @returns 当前语言代码
   */
  getCurrentLanguage(): string {
    return this.currentLanguage;
  }

  /**
   * 获取当前语言名称
   * @returns 当前语言名称
   */
  getCurrentLanguageName(): string {
    const pack = this.languagePacks.get(this.currentLanguage);
    return pack?.name || this.currentLanguage;
  }

  /**
   * 获取支持的语言列表
   * @returns 语言代码数组
   */
  getSupportedLanguages(): string[] {
    return Array.from(this.languagePacks.keys());
  }

  /**
   * 获取语言包信息
   * @returns 语言包信息数组
   */
  getLanguagePackInfo(): Array<{ code: string; name: string }> {
    return Array.from(this.languagePacks.values()).map((pack) => ({
      code: pack.code,
      name: pack.name,
    }));
  }

  /**
   * 翻译文本
   * @param key 翻译键
   * @param params 替换参数
   * @returns 翻译后的文本
   */
  translate(key: string, params?: Record<string, string>): string {
    const translation = this.getTranslation(key);

    if (!params) {
      return translation;
    }

    // 替换参数
    return translation.replace(/\{\{(\w+)\}\}/g, (match, paramKey) => {
      return params[paramKey] || match;
    });
  }

  /**
   * 获取翻译文本
   * @param key 翻译键
   * @returns 翻译文本
   */
  private getTranslation(key: string): string {
    // 尝试当前语言
    const currentPack = this.languagePacks.get(this.currentLanguage);
    if (currentPack?.translations[key]) {
      return currentPack.translations[key];
    }

    // 尝试回退语言
    const fallbackPack = this.languagePacks.get(this.fallbackLanguage);
    if (fallbackPack?.translations[key]) {
      return fallbackPack.translations[key];
    }

    // 返回键名
    return key;
  }

  /**
   * 检查翻译键是否存在
   * @param key 翻译键
   * @returns 是否存在
   */
  hasTranslation(key: string): boolean {
    const currentPack = this.languagePacks.get(this.currentLanguage);
    if (currentPack?.translations[key]) {
      return true;
    }

    const fallbackPack = this.languagePacks.get(this.fallbackLanguage);
    return !!fallbackPack?.translations[key];
  }

  /**
   * 添加翻译
   * @param language 语言代码
   * @param key 翻译键
   * @param translation 翻译文本
   */
  addTranslation(language: string, key: string, translation: string): void {
    const pack = this.languagePacks.get(language);
    if (pack) {
      pack.translations[key] = translation;
    }
  }

  /**
   * 批量添加翻译
   * @param language 语言代码
   * @param translations 翻译对象
   */
  addTranslations(
    language: string,
    translations: Record<string, string>
  ): void {
    const pack = this.languagePacks.get(language);
    if (pack) {
      Object.assign(pack.translations, translations);
    }
  }

  /**
   * 获取语言包
   * @param language 语言代码
   * @returns 语言包或undefined
   */
  getLanguagePack(language: string): LanguagePack | undefined {
    return this.languagePacks.get(language);
  }

  /**
   * 删除语言包
   * @param language 语言代码
   */
  removeLanguagePack(language: string): void {
    if (language === this.fallbackLanguage) {
      logger.warn('不能删除默认回退语言包');
      return;
    }
    this.languagePacks.delete(language);
  }

  /**
   * 设置回退语言
   * @param language 语言代码
   */
  setFallbackLanguage(language: string): void {
    if (!this.languagePacks.has(language)) {
      logger.warn(`语言包 ${language} 不存在`);
      return;
    }
    this.fallbackLanguage = language;
  }

  /**
   * 获取回退语言
   * @returns 回退语言代码
   */
  getFallbackLanguage(): string {
    return this.fallbackLanguage;
  }

  /**
   * 清除所有语言包
   */
  clearLanguagePacks(): void {
    this.languagePacks.clear();
    this.currentLanguage = this.fallbackLanguage;
  }

  /**
   * 获取翻译键数量
   * @param language 语言代码
   * @returns 翻译键数量
   */
  getTranslationCount(language?: string): number {
    const pack = this.languagePacks.get(language || this.currentLanguage);
    return pack ? Object.keys(pack.translations).length : 0;
  }
}

// 导出单例实例
export const i18nManager = new I18nManager();
