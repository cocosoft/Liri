/**
 * 解析器注册表
 * 对标 Hermes PARSER_REGISTRY + register_parser 装饰器 + get_parser
 *
 * 按解析器名称注册，支持按模型名称自动匹配
 */
import type { BaseParser } from './BaseParser';
import type { ParsedResult } from './types';

export class ParserRegistry {
  private parsers: Map<string, BaseParser> = new Map();
  private modelToParser: Map<string, string> = new Map();

  /**
   * 注册解析器
   * @param parser 解析器实例
   */
  register(parser: BaseParser): void {
    this.parsers.set(parser.name, parser);
    for (const pattern of parser.modelPatterns) {
      this.modelToParser.set(pattern.toLowerCase(), parser.name);
    }
  }

  /**
   * 注销解析器
   * @param name 解析器名称
   */
  unregister(name: string): boolean {
    const parser = this.parsers.get(name);
    if (!parser) return false;

    this.parsers.delete(name);
    for (const [model, parserName] of this.modelToParser) {
      if (parserName === name) {
        this.modelToParser.delete(model);
      }
    }
    return true;
  }

  /**
   * 按名称获取解析器
   * @param name 解析器名称（如 "hermes", "deepseek_v3"）
   */
  getByName(name: string): BaseParser | undefined {
    return this.parsers.get(name);
  }

  /**
   * 按模型名自动匹配解析器
   * @param model 模型名称
   */
  getByModel(model: string): BaseParser | undefined {
    const normalized = model.toLowerCase();

    const parserName = this.modelToParser.get(normalized);
    if (parserName) {
      return this.parsers.get(parserName);
    }

    for (const [registeredModel, pn] of this.modelToParser) {
      if (normalized.startsWith(registeredModel) || registeredModel.startsWith(normalized)) {
        return this.parsers.get(pn);
      }
    }

    return undefined;
  }

  /**
   * 降级解析：遍历所有已注册解析器尝试提取工具调用
   * 对标 Hermes agent_loop.py 中的 fallback parser 逻辑
   *
   * @param text 模型原始输出文本
   * @returns 首个成功提取的解析结果；若无匹配则返回原始文本
   */
  parseFallback(text: string): ParsedResult {
    for (const parser of this.parsers.values()) {
      if (parser.mayContainToolCalls(text)) {
        const result = parser.parse(text);
        if (result.toolCalls && result.toolCalls.length > 0) {
          return result;
        }
      }
    }
    return { content: text, toolCalls: null };
  }

  /**
   * 列出所有已注册的解析器名称
   */
  listNames(): string[] {
    return Array.from(this.parsers.keys());
  }

  /** 已注册解析器数量 */
  get size(): number {
    return this.parsers.size;
  }

  has(name: string): boolean {
    return this.parsers.has(name);
  }
}

export const parserRegistry = new ParserRegistry();
