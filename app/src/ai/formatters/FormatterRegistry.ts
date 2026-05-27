/**
 * FormatterRegistry 模型格式化器注册表
 *
 * 按模型名前缀自动路由到对应的 ModelFormatter 实现。
 * 支持自定义注册、按模型查找、默认格式化器回退。
 *
 * 路由规则：
 * - claude-* → AnthropicFormatter
 * - gemini-* → GeminiFormatter
 * - deepseek-* → DeepSeekFormatter
 * - 其余 → OpenAIFormatter（兼容 OpenAI / Grok / Moonshot / Ollama 等）
 */

import { ModelFormatter } from './ModelFormatter';
import { OpenAIFormatter } from './OpenAIFormatter';
import { AnthropicFormatter } from './AnthropicFormatter';
import { GeminiFormatter } from './GeminiFormatter';
import { DeepSeekFormatter } from './DeepSeekFormatter';

/**
 * 模型名前缀与格式化器的映射项
 */
interface FormatterEntry {
  prefixes: string[];
  formatter: ModelFormatter;
}

/**
 * 格式化器注册表
 */
export class FormatterRegistry {
  private static instance: FormatterRegistry;

  /** 默认格式化器（OpenAI 兼容） */
  private defaultFormatter: ModelFormatter;

  /** 前缀 → 格式化器映射 */
  private entries: FormatterEntry[] = [];

  private constructor() {
    this.defaultFormatter = new OpenAIFormatter();
    this.registerDefaults();
  }

  /**
   * 获取单例
   */
  static getInstance(): FormatterRegistry {
    if (!FormatterRegistry.instance) {
      FormatterRegistry.instance = new FormatterRegistry();
    }
    return FormatterRegistry.instance;
  }

  /**
   * 注册默认格式化器
   */
  private registerDefaults(): void {
    const anthropic = new AnthropicFormatter();
    const gemini = new GeminiFormatter();
    const deepseek = new DeepSeekFormatter();

    this.entries.push({
      prefixes: ['claude-'],
      formatter: anthropic,
    });

    this.entries.push({
      prefixes: ['gemini-'],
      formatter: gemini,
    });

    this.entries.push({
      prefixes: ['deepseek-'],
      formatter: deepseek,
    });
  }

  /**
   * 注册自定义格式化器
   */
  register(prefixes: string[], formatter: ModelFormatter): void {
    this.entries.push({ prefixes, formatter });
  }

  /**
   * 根据模型名获取格式化器
   * 按注册顺序匹配前缀（先注册优先）
   * @param modelName 模型名称（如 claude-sonnet-4-6、gpt-4o）
   * @returns 匹配的格式化器，无匹配时返回默认格式化器
   */
  getFormatter(modelName: string): ModelFormatter {
    const lower = modelName.toLowerCase();

    for (const entry of this.entries) {
      for (const prefix of entry.prefixes) {
        if (lower.startsWith(prefix)) {
          return entry.formatter;
        }
      }
    }

    return this.defaultFormatter;
  }

  /**
   * 设置默认格式化器
   */
  setDefaultFormatter(formatter: ModelFormatter): void {
    this.defaultFormatter = formatter;
  }

  /**
   * 获取默认格式化器
   */
  getDefaultFormatter(): ModelFormatter {
    return this.defaultFormatter;
  }

  /**
   * 重置为初始状态（用于测试）
   */
  reset(): void {
    this.entries = [];
    this.defaultFormatter = new OpenAIFormatter();
    this.registerDefaults();
  }
}

/** 全局单例引用 */
export const formatterRegistry = FormatterRegistry.getInstance();
