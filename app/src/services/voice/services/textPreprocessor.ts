/**
 * TextPreprocessor
 * TTS 文本预处理器
 *
 * 在文本送入 TTS 合成引擎之前进行归一化处理：
 * - 空白归一化
 * - 引号统一
 * - HTML 标签移除
 * - URL/邮箱简化
 * - 特殊符号处理
 * - 控制字符移除
 * - 中英文混排空格优化
 */

/**
 * 文本预处理选项
 */
export interface TextPreprocessOptions {
  /** 是否移除 HTML 标签，默认 true */
  removeHtmlTags?: boolean;
  /** 是否将 URL 替换为 "[链接]"，默认 true */
  simplifyUrls?: boolean;
  /** 是否将邮箱替换为 "[邮箱]"，默认 true */
  simplifyEmails?: boolean;
  /** 是否合并连续空白为单个空格，默认 true */
  normalizeWhitespace?: boolean;
  /** 是否统一引号格式，默认 true */
  normalizeQuotes?: boolean;
  /** 是否移除控制字符，默认 true */
  removeControlChars?: boolean;
  /** 是否处理特殊符号，默认 true */
  handleSpecialChars?: boolean;
  /** 是否优化中英文混排空格，默认 true */
  optimizeCjkSpacing?: boolean;
  /** 自定义替换规则，按顺序应用 */
  customRules?: Array<{ pattern: RegExp; replacement: string }>;
}

/** 默认选项 */
const DEFAULT_OPTIONS: Required<TextPreprocessOptions> = {
  removeHtmlTags: true,
  simplifyUrls: true,
  simplifyEmails: true,
  normalizeWhitespace: true,
  normalizeQuotes: true,
  removeControlChars: true,
  handleSpecialChars: true,
  optimizeCjkSpacing: true,
  customRules: [],
};

// 正则表达式常量
const RE_HTML_TAGS = /<[^>]*>/g;
const RE_URL = /https?:\/\/[^\s'"）)]+/g;
const RE_EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const RE_CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const RE_MULTI_SPACE = /[ \t]+/g;
const RE_MULTI_NEWLINE = /\n{3,}/g;
const RE_LEADING_TRAILING_SPACE = /^[\s\n]+|[\s\n]+$/g;
const RE_CJK = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;
const RE_CJK_EN_SPACE = /([\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff])([a-zA-Z0-9@#$%&])/g;
const RE_EN_CJK_SPACE = /([a-zA-Z0-9@#$%&])([\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff])/g;
const RE_SPECIAL_CHARS = /[……]{2,}/g;
const RE_EM_DASH = /—{2,}/g;
const RE_CONSECUTIVE_DOTS = /\.{3,}/g;
const RE_NARROW_NBSP = /\u202F|\u200B|\uFEFF/g;

/**
 * 文本预处理器
 */
export class TextPreprocessor {
  private options: Required<TextPreprocessOptions>;

  constructor(options: TextPreprocessOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * 更新配置
   */
  updateOptions(options: Partial<TextPreprocessOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * 预处理文本
   */
  process(input: string): string {
    if (!input) {
      return '';
    }

    let text = input;

    // 1. 统一换行符
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // 2. 移除控制字符
    if (this.options.removeControlChars) {
      text = text.replace(RE_CONTROL_CHARS, '');
    }

    // 3. 移除窄空格和零宽字符
    text = text.replace(RE_NARROW_NBSP, ' ');

    // 4. 统一引号
    if (this.options.normalizeQuotes) {
      text = this.normalizeQuotes(text);
    }

    // 5. 处理特殊符号
    if (this.options.handleSpecialChars) {
      text = this.handleSpecialChars(text);
    }

    // 6. 移除 HTML 标签
    if (this.options.removeHtmlTags) {
      text = text.replace(RE_HTML_TAGS, '');
    }

    // 7. 简化 URL
    if (this.options.simplifyUrls) {
      text = text.replace(RE_URL, '[链接]');
    }

    // 8. 简化邮箱
    if (this.options.simplifyEmails) {
      text = text.replace(RE_EMAIL, '[邮箱]');
    }

    // 9. 空白归一化
    if (this.options.normalizeWhitespace) {
      text = this.normalizeWhitespace(text);
    }

    // 10. 中英文混排空格优化
    if (this.options.optimizeCjkSpacing) {
      text = this.optimizeCjkSpacing(text);
    }

    // 11. 应用自定义规则
    for (const rule of this.options.customRules) {
      text = text.replace(rule.pattern, rule.replacement);
    }

    return text;
  }

  /**
   * 统一引号格式
   * 将智能/弯引号统一为直引号
   */
  private normalizeQuotes(text: string): string {
    return text
      .replace(/\u201C|\u201D/g, '"')
      .replace(/\u2018|\u2019/g, "'")
      .replace(/\u201E|\u201F/g, '"')
      .replace(/\u300C/g, '\u300C')
      .replace(/\u300D/g, '\u300D')
      .replace(/\u300E/g, '\u300E')
      .replace(/\u300F/g, '\u300F');
  }

  /**
   * 处理特殊符号
   * - 多个连续省略号 → 单个
   * - 多个连续破折号 → 简化
   * - 多个连续点号 → "等等"
   */
  private handleSpecialChars(text: string): string {
    return text
      .replace(RE_SPECIAL_CHARS, '……')
      .replace(RE_EM_DASH, '——')
      .replace(RE_CONSECUTIVE_DOTS, '...');
  }

  /**
   * 空白归一化
   * - 多个连续空格 → 单个空格
   * - 多个连续换行 → 两个换行
   * - 去除首尾空白
   */
  private normalizeWhitespace(text: string): string {
    return text
      .replace(RE_MULTI_NEWLINE, '\n\n')
      .replace(RE_MULTI_SPACE, ' ')
      .replace(RE_LEADING_TRAILING_SPACE, '');
  }

  /**
   * 优化中英文混排空格
   * 在中文与英文/数字之间插入空格，改善 TTS 朗读节奏
   */
  private optimizeCjkSpacing(text: string): string {
    return text
      .replace(RE_CJK_EN_SPACE, '$1 $2')
      .replace(RE_EN_CJK_SPACE, '$1 $2');
  }

  /**
   * 是否为 CJK 段落的快速判断
   * 检查文本是否包含 CJK 字符
   */
  static containsCjk(text: string): boolean {
    return RE_CJK.test(text);
  }
}

/**
 * 便捷函数：单次预处理
 */
export function preprocessText(
  input: string,
  options?: TextPreprocessOptions
): string {
  const preprocessor = new TextPreprocessor(options);
  return preprocessor.process(input);
}
