/**
 * 运行时脱敏引擎
 * 对标 Hermes agent/redact.py，提供通用文本和结构化数据的脱敏能力
 */
import {
  SENSITIVE_KEY_PATTERNS,
  SENSITIVE_BODY_PATTERNS,
  SHORT_TOKEN_MIN_LENGTH,
  LONG_TOKEN_PREFIX_CHARS,
  LONG_TOKEN_SUFFIX_CHARS,
  NUMERIC_SENSITIVE_PATTERNS,
  EMAIL_PATTERN,
  REDACTED_PLACEHOLDER,
  REDACTED_CONTEXT_PLACEHOLDER,
} from './RedactPatterns';

/**
 * 脱敏结果
 */
export interface RedactResult {
  redacted: boolean;
  output: string;
  matches: string[];
}

/**
 * 对象脱敏结果
 */
export interface ObjectRedactResult {
  redacted: boolean;
  output: Record<string, unknown>;
  redactedKeys: string[];
}

/**
 * 运行时脱敏引擎
 * 支持文本和结构化数据的脱敏处理
 */
export class RuntimeRedactEngine {
  private enabled: boolean;
  private keyPatterns: RegExp[];
  private bodyPatterns: RegExp[];
  private extraPatterns: RegExp[];

  /**
   * 构造函数
   * @param enabled 是否启用脱敏
   * @param extraPatterns 额外的自定义敏感模式
   */
  constructor(enabled: boolean = true, extraPatterns: RegExp[] = []) {
    this.enabled = enabled;
    this.keyPatterns = [...SENSITIVE_KEY_PATTERNS];
    this.bodyPatterns = [...SENSITIVE_BODY_PATTERNS];
    this.extraPatterns = extraPatterns;
  }

  /**
   * 设置脱敏开关
   * @param enabled 是否启用
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * 获取脱敏开关状态
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 添加自定义敏感模式
   * @param pattern 正则表达式模式
   */
  addPattern(pattern: RegExp): void {
    this.extraPatterns.push(pattern);
  }

  /**
   * 移除所有自定义敏感模式
   */
  clearExtraPatterns(): void {
    this.extraPatterns = [];
  }

  /**
   * 判断是否为短 Token（需要完全遮盖）
   * @param token Token 字符串
   * @returns 是否为短 Token
   */
  isShortToken(token: string): boolean {
    return token.length > 0 && token.length < SHORT_TOKEN_MIN_LENGTH;
  }

  /**
   * 短 Token 完全遮盖
   * @param token Token 字符串
   * @returns 遮盖后的字符串
   */
  redactShortToken(token: string): string {
    return REDACTED_PLACEHOLDER;
  }

  /**
   * 长 Token 部分遮盖（保留首6尾4）
   * @param token Token 字符串
   * @returns 遮盖后的字符串
   */
  redactLongToken(token: string): string {
    if (token.length <= LONG_TOKEN_PREFIX_CHARS + LONG_TOKEN_SUFFIX_CHARS) {
      return REDACTED_PLACEHOLDER;
    }

    const prefix = token.slice(0, LONG_TOKEN_PREFIX_CHARS);
    const suffix = token.slice(-LONG_TOKEN_SUFFIX_CHARS);
    const middleLen =
      token.length - LONG_TOKEN_PREFIX_CHARS - LONG_TOKEN_SUFFIX_CHARS;

    return prefix + '*'.repeat(Math.min(middleLen, 8)) + suffix;
  }

  /**
   * 脱敏 Token 字符串
   * @param value 待脱敏的值
   * @returns 脱敏后的字符串
   */
  redactToken(value: string): string {
    if (!value || value.length === 0) {
      return value;
    }

    if (this.isShortToken(value)) {
      return this.redactShortToken(value);
    }

    return this.redactLongToken(value);
  }

  /**
   * 脱敏文本中的敏感内容
   * @param text 原始文本
   * @returns 脱敏后的文本
   */
  redactText(text: string): RedactResult {
    if (!this.enabled || !text) {
      return { redacted: false, output: text, matches: [] };
    }

    let result = text;
    const matches: string[] = [];
    const allPatterns = [
      ...this.keyPatterns,
      ...this.bodyPatterns,
      ...this.extraPatterns,
    ];

    for (const pattern of allPatterns) {
      if (pattern.test(result)) {
        matches.push(pattern.source);
      }
    }

    result = result.replace(EMAIL_PATTERN, (match) => {
      matches.push(match);

      return REDACTED_CONTEXT_PLACEHOLDER;
    });

    for (const pattern of NUMERIC_SENSITIVE_PATTERNS) {
      result = result.replace(pattern, (match) => {
        matches.push(match);

        return REDACTED_PLACEHOLDER;
      });
    }

    return {
      redacted: matches.length > 0,
      output: result,
      matches,
    };
  }

  /**
   * 检查键名是否匹配敏感模式
   * @param key 键名
   * @returns 是否匹配
   */
  isSensitiveKey(key: string): boolean {
    for (const pattern of this.keyPatterns) {
      if (pattern.test(key)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 检查 Body 键名是否匹配敏感模式
   * @param key 键名
   * @returns 是否匹配
   */
  isSensitiveBodyKey(key: string): boolean {
    for (const pattern of this.bodyPatterns) {
      if (pattern.test(key)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 脱敏对象中的敏感字段（递归处理）
   * @param obj 原始对象
   * @param currentPath 当前路径
   * @returns 脱敏后的对象和脱敏结果
   */
  redactObject(
    obj: Record<string, unknown>,
    currentPath: string = ''
  ): ObjectRedactResult {
    if (!this.enabled) {
      return { redacted: false, output: obj, redactedKeys: [] };
    }

    const redactedKeys: string[] = [];
    const output: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      const fullPath = currentPath ? `${currentPath}.${key}` : key;

      if (this.isSensitiveKey(key) || this.isSensitiveBodyKey(fullPath)) {
        redactedKeys.push(fullPath);

        if (typeof value === 'string') {
          output[key] = this.redactToken(value);
        } else {
          output[key] = REDACTED_CONTEXT_PLACEHOLDER;
        }

        continue;
      }

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nested = this.redactObject(
          value as Record<string, unknown>,
          fullPath
        );
        if (nested.redacted) {
          redactedKeys.push(...nested.redactedKeys);
        }
        output[key] = nested.output;
      } else if (Array.isArray(value)) {
        output[key] = this.redactArray(value, fullPath, redactedKeys);
      } else if (typeof value === 'string') {
        const textResult = this.redactText(value);
        if (textResult.redacted) {
          redactedKeys.push(fullPath);
          output[key] = textResult.output;
        } else {
          output[key] = value;
        }
      } else {
        output[key] = value;
      }
    }

    return {
      redacted: redactedKeys.length > 0,
      output,
      redactedKeys,
    };
  }

  /**
   * 脱敏数组元素
   * @param arr 原始数组
   * @param parentPath 父路径
   * @param redactedKeys 脱敏键累积列表
   * @returns 脱敏后的数组
   */
  private redactArray(
    arr: unknown[],
    parentPath: string,
    redactedKeys: string[]
  ): unknown[] {
    return arr.map((item, index) => {
      const itemPath = `${parentPath}[${index}]`;

      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const nested = this.redactObject(
          item as Record<string, unknown>,
          itemPath
        );
        if (nested.redacted) {
          redactedKeys.push(...nested.redactedKeys);
        }

        return nested.output;
      }

      if (typeof item === 'string') {
        const textResult = this.redactText(item);
        if (textResult.redacted) {
          redactedKeys.push(itemPath);

          return textResult.output;
        }
      }

      return item;
    });
  }

  /**
   * 脱敏 JSON 字符串
   * @param jsonStr JSON 格式的字符串
   * @returns 脱敏后的 JSON 字符串
   */
  redactJson(jsonStr: string): RedactResult {
    if (!this.enabled || !jsonStr) {
      return { redacted: false, output: jsonStr, matches: [] };
    }

    try {
      const parsed = JSON.parse(jsonStr);

      if (typeof parsed !== 'object' || parsed === null) {
        return this.redactText(jsonStr);
      }

      const result = this.redactObject(parsed);

      return {
        redacted: result.redacted,
        output: JSON.stringify(result.output),
        matches: result.redactedKeys,
      };
    } catch {
      return this.redactText(jsonStr);
    }
  }

  /**
   * 脱敏日志消息（message + context 组合）
   * @param message 日志消息
   * @param context 日志上下文
   * @returns 脱敏后的消息和上下文
   */
  redactLogEntry(
    message: string,
    context?: Record<string, unknown>
  ): { message: string; context?: Record<string, unknown> } {
    if (!this.enabled) {
      return { message, context };
    }

    const messageResult = this.redactText(message);
    let redactedContext = context;

    if (context) {
      const contextResult = this.redactObject(context);
      if (contextResult.redacted) {
        redactedContext = contextResult.output;
      }
    }

    return {
      message: messageResult.output,
      context: redactedContext,
    };
  }
}

/**
 * 创建默认的运行时脱敏引擎实例
 */
export function createRuntimeRedactEngine(
  enabled: boolean = true,
  extraPatterns: RegExp[] = []
): RuntimeRedactEngine {
  return new RuntimeRedactEngine(enabled, extraPatterns);
}
