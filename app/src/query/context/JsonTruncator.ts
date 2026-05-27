/**
 * JSON 安全截断工具
 * 对标 Hermes _truncate_tool_call_args_json()
 * 在保持 JSON 有效性的前提下安全截断过长参数
 */

/**
 * JSON 截断配置
 */
export interface JsonTruncatorConfig {
  maxLength: number;
  maxDepth: number;
  preserveKeys: string[];
}

/**
 * 默认截断配置
 */
export const DEFAULT_TRUNCATOR_CONFIG: JsonTruncatorConfig = {
  maxLength: 4096,
  maxDepth: 10,
  preserveKeys: ['name', 'id', 'type', 'title', 'key'],
};

/**
 * JSON 安全截断工具
 */
export class JsonTruncator {
  private config: JsonTruncatorConfig;

  /**
   * 构造函数
   * @param config 截断配置
   */
  constructor(config?: Partial<JsonTruncatorConfig>) {
    this.config = { ...DEFAULT_TRUNCATOR_CONFIG, ...config };
  }

  /**
   * 截断 JSON 字符串
   * @param jsonStr JSON 字符串
   * @returns 截断后的字符串
   */
  truncate(jsonStr: string): string {
    if (jsonStr.length <= this.config.maxLength) {
      return jsonStr;
    }

    try {
      const parsed = JSON.parse(jsonStr);

      if (typeof parsed !== 'object' || parsed === null) {
        return this.truncateString(jsonStr);
      }

      const truncated = this.truncateObject(parsed, 0);
      const result = JSON.stringify(truncated);

      if (result.length <= this.config.maxLength) {
        return result;
      }

      return this.truncateString(result);
    } catch {
      return this.truncateString(jsonStr);
    }
  }

  /**
   * 递归截断对象
   * @param obj 对象
   * @param depth 当前深度
   * @returns 截断后的对象
   */
  private truncateObject(obj: unknown, depth: number): unknown {
    if (depth >= this.config.maxDepth) {
      return '[truncated: max depth]';
    }

    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      return this.truncateString(obj);
    }

    if (typeof obj === 'number' || typeof obj === 'boolean') {
      return obj;
    }

    if (Array.isArray(obj)) {
      const maxItems = 20;
      const truncated = obj
        .slice(0, maxItems)
        .map((item) => this.truncateObject(item, depth + 1));

      if (obj.length > maxItems) {
        truncated.push(`[truncated: ${obj.length - maxItems} more items]`);
      }

      return truncated;
    }

    if (typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      const entries = Object.entries(obj as Record<string, unknown>);
      const maxKeys = 30;

      for (const [key, value] of entries.slice(0, maxKeys)) {
        if (this.config.preserveKeys.includes(key)) {
          result[key] = value;
        } else {
          result[key] = this.truncateObject(value, depth + 1);
        }
      }

      if (entries.length > maxKeys) {
        result['__truncated_keys__'] =
          `${entries.length - maxKeys} more keys truncated`;
      }

      return result;
    }

    return String(obj);
  }

  /**
   * 截断字符串
   * @param str 字符串
   * @returns 截断后的字符串
   */
  private truncateString(str: string): string {
    const maxLen = Math.floor(this.config.maxLength / 2);

    if (str.length <= maxLen) {
      return str;
    }

    const prefix = str.slice(0, Math.floor(maxLen * 0.6));
    const suffix = str.slice(-Math.floor(maxLen * 0.3));

    return `${prefix}\n...[truncated ${str.length - prefix.length - suffix.length} chars]...\n${suffix}`;
  }

  /**
   * 检查 JSON 字符串是否需要截断
   * @param jsonStr JSON 字符串
   * @returns 是否需要截断
   */
  needsTruncation(jsonStr: string): boolean {
    return jsonStr.length > this.config.maxLength;
  }

  /**
   * 获取字符串截断信息
   * @param jsonStr JSON 字符串
   * @returns 截断信息
   */
  getTruncationInfo(jsonStr: string): {
    originalLength: number;
    truncated: boolean;
  } {
    return {
      originalLength: jsonStr.length,
      truncated: this.needsTruncation(jsonStr),
    };
  }
}
