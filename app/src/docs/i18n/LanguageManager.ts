/**
 * 多语言管理
 *
 * 支持多语言的语言包管理和切换
 */

import { getConfig, setConfigValue } from '@modules/config/index.js';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { resolveDataSubDir, resolveProjectRoot } from '@modules/config/paths';

/**
 * 语言包接口
 */
export interface LanguagePack {
  code: string;
  name: string;
  nativeName: string;
  messages: Record<string, string>;
}

/**
 * 多语言管理类
 */
export class LanguageManager {
  private static instance: LanguageManager | null = null;
  private languagePacks: Map<string, LanguagePack> = new Map();
  private currentLanguage: string = 'zh-CN';
  private initialized = false;

  private constructor() {
    this.loadLanguagePacks();
  }

  static getInstance(): LanguageManager {
    if (!LanguageManager.instance) {
      LanguageManager.instance = new LanguageManager();
    }
    return LanguageManager.instance;
  }

  private lazyInit(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.loadCustomLanguagePacks();
    this.loadCurrentLanguage();
  }

  /**
   * 加载语言包
   */
  private loadLanguagePacks(): void {
    // 内置语言包（纯数据，不依赖配置）
    this.languagePacks.set('zh-CN', {
      code: 'zh-CN',
      name: 'Chinese (Simplified)',
      nativeName: '中文（简体）',
      messages: {
        'help.quickstart.title': '快速开始',
        'help.quickstart.description': '了解PY_APP的基本使用方法',
        'help.commands.title': '命令参考',
        'help.commands.description': '所有可用命令的详细说明',
        'help.shortcuts.title': '快捷键',
        'help.shortcuts.description': '键盘快捷键列表',
        'help.tools.title': '工具列表',
        'help.tools.description': '所有可用工具的详细说明',
        'help.skills.title': '技能列表',
        'help.skills.description': '所有可用技能的详细说明',
        'help.examples.title': '示例命令',
        'help.examples.description': '常用示例命令，帮助你快速上手',
        'help.release-notes.title': '释放说明',
        'help.release-notes.description': '版本更新的释放说明',
        'error.network.timeout': '网络请求超时',
        'error.network.connection': '网络连接失败',
        'error.file.not-found': '文件未找到',
        'error.permission.denied': '权限被拒绝',
        'error.validation.failed': '验证失败',
        'example.command.fix-lint': 'fix lint errors',
        'example.command.fix-typecheck': 'fix typecheck errors',
        'example.command.how-does-work': 'how does {file} work?',
        'example.command.refactor': 'refactor {file}',
        'example.command.how-to-log': 'how do I log an error?',
        'example.command.edit': 'edit {file} to...',
        'example.command.write-test': 'write a test for {file}',
        'example.command.create-util': 'create a util logging.py that...',
        'release-notes.title': '释放说明',
        'release-notes.view-full': '查看完整释放说明',
      },
    });

    this.languagePacks.set('en-US', {
      code: 'en-US',
      name: 'English (US)',
      nativeName: 'English (US)',
      messages: {
        'help.quickstart.title': 'Quick Start',
        'help.quickstart.description': 'Learn the basic usage of PY_APP',
        'help.commands.title': 'Command Reference',
        'help.commands.description':
          'Detailed explanation of all available commands',
        'help.shortcuts.title': 'Keyboard Shortcuts',
        'help.shortcuts.description': 'List of keyboard shortcuts',
        'help.tools.title': 'Tool List',
        'help.tools.description': 'Detailed explanation of all available tools',
        'help.skills.title': 'Skill List',
        'help.skills.description':
          'Detailed explanation of all available skills',
        'help.examples.title': 'Example Commands',
        'help.examples.description':
          'Common example commands to help you get started',
        'help.release-notes.title': 'Release Notes',
        'help.release-notes.description': 'Release notes for version updates',
        'error.network.timeout': 'Network request timeout',
        'error.network.connection': 'Network connection failed',
        'error.file.not-found': 'File not found',
        'error.permission.denied': 'Permission denied',
        'error.validation.failed': 'Validation failed',
        'example.command.fix-lint': 'fix lint errors',
        'example.command.fix-typecheck': 'fix typecheck errors',
        'example.command.how-does-work': 'how does {file} work?',
        'example.command.refactor': 'refactor {file}',
        'example.command.how-to-log': 'how do I log an error?',
        'example.command.edit': 'edit {file} to...',
        'example.command.write-test': 'write a test for {file}',
        'example.command.create-util': 'create a util logging.py that...',
        'release-notes.title': 'Release Notes',
        'release-notes.view-full': 'View full release notes',
      },
    });

    // 尝试加载自定义语言包（移至 lazyInit 延迟调用）
  }

  /**
   * 加载自定义语言包
   */
  private loadCustomLanguagePacks(): void {
    try {
      const config = getConfig();
      const languagePacksDir = join(resolveProjectRoot(), 'language-packs');

      if (existsSync(languagePacksDir)) {
        // 这里可以实现从目录加载自定义语言包
        // 暂时跳过，因为我们使用内置语言包
      }
    } catch (error) {
      // 忽略加载失败
    }
  }

  /**
   * 加载当前语言设置
   */
  private loadCurrentLanguage(): void {
    const config = getConfig();
    if (config.docs && config.docs.language) {
      this.currentLanguage = config.docs.language;
    }
  }

  /**
   * 保存当前语言设置
   */
  private saveCurrentLanguage(): void {
    setConfigValue('docs.language', this.currentLanguage);
  }

  /**
   * 获取当前语言
   * @returns 当前语言代码
   */
  getCurrentLanguage(): string {
    this.lazyInit();
    return this.currentLanguage;
  }

  /**
   * 设置当前语言
   * @param languageCode 语言代码
   * @returns 是否设置成功
   */
  setCurrentLanguage(languageCode: string): boolean {
    this.lazyInit();
    if (this.languagePacks.has(languageCode)) {
      this.currentLanguage = languageCode;
      this.saveCurrentLanguage();
      return true;
    }
    return false;
  }

  /**
   * 获取所有可用语言
   * @returns 语言包列表
   */
  getAvailableLanguages(): LanguagePack[] {
    return Array.from(this.languagePacks.values());
  }

  /**
   * 翻译文本
   * @param key 翻译键
   * @param variables 变量替换
   * @returns 翻译后的文本
   */
  translate(key: string, variables: Record<string, string> = {}): string {
    this.lazyInit();
    const languagePack = this.languagePacks.get(this.currentLanguage);
    let message = languagePack?.messages[key] || key;

    // 替换变量
    for (const [varName, value] of Object.entries(variables)) {
      message = message.replace(`{${varName}}`, value);
    }

    return message;
  }

  /**
   * 注册语言包
   * @param languagePack 语言包
   */
  registerLanguagePack(languagePack: LanguagePack): void {
    this.languagePacks.set(languagePack.code, languagePack);
  }

  /**
   * 获取语言包
   * @param languageCode 语言代码
   * @returns 语言包
   */
  getLanguagePack(languageCode: string): LanguagePack | undefined {
    return this.languagePacks.get(languageCode);
  }

  /**
   * 检查语言是否可用
   * @param languageCode 语言代码
   * @returns 是否可用
   */
  isLanguageAvailable(languageCode: string): boolean {
    return this.languagePacks.has(languageCode);
  }
}

export const languageManager = LanguageManager.getInstance();

export function getLanguageManager(): LanguageManager {
  return languageManager;
}

export default languageManager;
