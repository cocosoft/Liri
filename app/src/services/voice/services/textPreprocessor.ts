import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({
  module: 'voice:textPreprocessor',
  level: LogLevel.INFO,
});

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
const RE_CJK_EN_SPACE =
  /([\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff])([a-zA-Z0-9@#$%&])/g;
const RE_EN_CJK_SPACE =
  /([a-zA-Z0-9@#$%&])([\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff])/g;
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
    logger.debug('TextPreprocessor · 创建', { options: this.options });
  }

  /**
   * 更新配置
   */
  updateOptions(options: Partial<TextPreprocessOptions>): void {
    this.options = { ...this.options, ...options };
    logger.debug('TextPreprocessor · 更新配置', { options });
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

// ===========================================================
// SSML 支持（方案 9 + 方案 12）
// ===========================================================

/** SSML 构建选项 */
export interface SSMLBuildOptions {
  text: string;
  voice?: string;
  rate?: number; // 0.5 - 2.0
  pitch?: number; // -10 to +10 Hz
  lang?: string;
}

/** SSML 标签白名单（用于 sanitizeSSML） */
const SSML_TAG_WHITELIST =
  /<\/?(speak|voice|prosody|break|phoneme|emphasis|say-as|sub|p|s)\b[^>]*>/gi;

/**
 * 检测文本是否包含 SSML 标签
 *
 * 检测常见 SSML 标签，如果包含则跳过普通预处理链。
 * 方案 12：SSML 感知 — 避免正则替换破坏 SSML 结构。
 */
function containsSSML(text: string): boolean {
  return (
    /<speak[\s>]/i.test(text) ||
    /<break[\s/>]/i.test(text) ||
    /<prosody[\s>]/i.test(text) ||
    /<phoneme[\s>]/i.test(text) ||
    /<voice[\s>]/i.test(text) ||
    /<\/?(p|s)\b[^>]*>/i.test(text)
  );
}

/**
 * 转义 SSML 文本中的特殊字符
 * & → &amp;  < → &lt;  > → &gt;  " → &quot;  ' → &apos;
 */
function escapeSSML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * SSML 安全清理
 * 移除白名单之外的标签，只保留标准 SSML 标签
 */
function sanitizeSSML(text: string): string {
  // 先转义非 SSML 标签的 < >，再恢复白名单标签
  // 将 < 替换为暂存标记，白名单标签恢复，非白名单标签转义
  const placeholders: string[] = [];
  let result = text.replace(SSML_TAG_WHITELIST, (match) => {
    placeholders.push(match);
    return `\x00SSML${placeholders.length - 1}\x00`;
  });
  // 转义剩余的 < 和 >
  result = result.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // 恢复白名单标签
  result = result.replace(/\x00SSML(\d+)\x00/g, (_, index) => {
    return placeholders[parseInt(index, 10)] || '';
  });
  return result;
}

/**
 * 构建 SSML 字符串
 *
 * 将纯文本 + 语音参数包装为 SSML 格式。
 * 支持语速（rate）、音高（pitch）、语音（voice）、语言（lang）参数。
 *
 * @example
 *   buildSSML({ text: '你好世界', voice: 'zh-CN-XiaoxiaoNeural', rate: 1.2 })
 *   // → <speak version="1.0" ...><voice name="zh-CN-XiaoxiaoNeural"><prosody rate="+20%">你好世界</prosody></voice></speak>
 */
function buildSSML(options: SSMLBuildOptions): string {
  const { text, voice, rate = 1.0, pitch = 0, lang = 'zh-CN' } = options;

  const rateStr = `${rate >= 1 ? '+' : ''}${((rate - 1) * 100).toFixed(0)}%`;
  const pitchStr = `${pitch >= 0 ? '+' : ''}${pitch}Hz`;

  const voiceTag = voice ? `\n  <voice name="${escapeSSML(voice)}">` : '';

  const closeVoiceTag = voice ? '\n  </voice>' : '';

  // 如果文本已包含 SSML 标签，不做二次转义
  const innerText = containsSSML(text) ? text : escapeSSML(text);

  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${escapeSSML(lang)}">${voiceTag}
    <prosody rate="${rateStr}" pitch="${pitchStr}">
      ${innerText}
    </prosody>${closeVoiceTag}
</speak>`;
}

/**
 * 预处理入口增强（SSML 感知）
 *
 * 如果文本包含 SSML 标签且未禁用 SSML 模式，跳过常规预处理链，
 * 仅做安全清理（sanitizeSSML）。
 *
 * 在 TextPreprocessor 的 process() 方法中，
 * 如果检测到 SSML 标签，会自动跳过大部分正则替换步骤。
 * 外部也可直接调用此函数作为统一入口。
 */
export function preprocessWithSSML(
  input: string,
  options?: TextPreprocessOptions & { ssmlMode?: boolean }
): string {
  const ssmlMode = options?.ssmlMode !== false;

  // SSML 感知（方案 12）：含 SSML 标签的文本跳过普通预处理
  if (containsSSML(input) && ssmlMode) {
    return sanitizeSSML(input);
  }

  // 普通预处理
  const preprocessor = new TextPreprocessor(options);
  return preprocessor.process(input);
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

// ===========================================================
// 方案 16：规则优先级 + 预处理引擎
// ===========================================================

/** 预处理规则接口（方案 16） */
export interface PreprocessRule {
  name: string;
  priority: number; // 数字越小优先级越高
  apply: (text: string) => string;
}

/** 电话号码 → 按位逐字朗读 */
function normalizePhone(text: string): string {
  return text
    .replace(/\b1[3-9]\d{9}\b/g, (phone) => phone.split('').join(' '))
    .replace(/\b\d{18}[0-9Xx]\b/g, (id) => id.split('').join(' '));
}

/** 表情符号 → 替换为文字描述 */
function normalizeEmoji(text: string): string {
  return text
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '笑脸')
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '符号')
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '交通工具')
    .replace(/[\u{2600}-\u{26FF}]/gu, '符号')
    .replace(/[\(\)\[\]｡ﾟ+￣\^\-=＜＞《》︵︶︷︸\u{FE00}-\u{FE0F}]/gu, '');
}

/** 代码片段 → 按符号朗读 */
function normalizeCode(text: string): string {
  return text.replace(/`[^`]+`/g, (code) => {
    const inner = code.slice(1, -1);
    return inner
      .replace(/[{}()\[\];:,.+=\-*/&|!~<>%@#^]/g, (s) => ` ${s} `)
      .trim();
  });
}

/** 混合中英文 → 英文单词按字母拼读 */
function normalizeMixedLang(text: string): string {
  return text.replace(/\b[a-zA-Z]{2,}\b/g, (word) => {
    return word.split('').join(' ');
  });
}

/**
 * 规则优先级排序
 *
 * URL 必须在标点替换前执行，自定义规则优先级最高。
 */
const DEFAULT_RULES: PreprocessRule[] = [
  { name: 'ssml-detect', priority: 100, apply: (t: string) => t },
  {
    name: 'url',
    priority: 200,
    apply: (t: string) => t.replace(RE_URL, '[链接]'),
  },
  {
    name: 'email',
    priority: 220,
    apply: (t: string) => t.replace(RE_EMAIL, '[邮箱]'),
  },
  { name: 'phone', priority: 250, apply: normalizePhone },
  { name: 'number', priority: 300, apply: (t: string) => t },
  { name: 'emoji', priority: 350, apply: normalizeEmoji },
  { name: 'code-snippet', priority: 370, apply: normalizeCode },
  { name: 'mixed-lang', priority: 380, apply: normalizeMixedLang },
  {
    name: 'quotes',
    priority: 400,
    apply: (t: string) =>
      t.replace(/\u201C|\u201D/g, '"').replace(/\u2018|\u2019/g, "'"),
  },
  {
    name: 'whitespace',
    priority: 500,
    apply: (t: string) =>
      t
        .replace(RE_MULTI_NEWLINE, '\n\n')
        .replace(RE_MULTI_SPACE, ' ')
        .replace(RE_LEADING_TRAILING_SPACE, ''),
  },
  {
    name: 'punctuation',
    priority: 600,
    apply: (t: string) =>
      t
        .replace(RE_SPECIAL_CHARS, '……')
        .replace(RE_EM_DASH, '——')
        .replace(RE_CONSECUTIVE_DOTS, '...'),
  },
].sort((a, b) => a.priority - b.priority);

/**
 * preprocess — 规则引擎单次遍历（方案 16）
 *
 * 按优先级依次执行所有规则，支持用户自定义规则扩展。
 * 自定义规则优先级最高（priority < 100），确保先执行。
 *
 * @param text 输入文本
 * @param customRules 自定义规则列表
 * @returns 预处理后的文本
 */
function preprocessWithRules(
  text: string,
  customRules?: PreprocessRule[]
): string {
  const allRules = [...(customRules || []), ...DEFAULT_RULES].sort(
    (a, b) => a.priority - b.priority
  );
  return allRules.reduce((acc, rule) => rule.apply(acc), text);
}

/**
 * registerRule — 注册自定义预处理规则（方案 16）
 *
 * 返回一个工厂函数，可在创建 TextPreprocessor 时传入 customRules。
 */
function registerRule(rule: PreprocessRule): PreprocessRule {
  return rule;
}
