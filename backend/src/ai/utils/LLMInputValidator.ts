/**
 * LLM输入验证工具
 * 提供消息验证、工具定义验证和内容安全检查
 */

import type { ChatMessage, ToolDefinition } from '../models/types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * LLM输入验证器
 */
export class LLMInputValidator {
  private static readonly MAX_MESSAGE_LENGTH = 100000;
  private static readonly MAX_MESSAGES = 100;
  private static readonly MAX_TOKENS = 128000;
  private static readonly DANGEROUS_PATTERNS = [
    /<script[\s\S]*?<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /data:/gi,
  ];

  static validateMessages(messages: ChatMessage[]): ValidationResult {
    const errors: string[] = [];

    if (!messages || messages.length === 0) {
      errors.push('消息列表不能为空');
      return { valid: false, errors };
    }

    if (messages.length > this.MAX_MESSAGES) {
      errors.push(`消息数量超过限制（最大${this.MAX_MESSAGES}）`);
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      if (!msg.role) {
        errors.push(`消息${i + 1}缺少role字段`);
      }

      if (!msg.content || typeof msg.content !== 'string') {
        errors.push(`消息${i + 1}缺少或无效的content字段`);
      }

      if (msg.content && msg.content.length > this.MAX_MESSAGE_LENGTH) {
        errors.push(`消息${i + 1}内容超过最大长度限制`);
      }

      if (msg.tool_calls) {
        const toolValidation = this.validateToolCalls(msg.tool_calls);
        if (!toolValidation.valid) {
          errors.push(
            ...toolValidation.errors.map((e) => `消息${i + 1}: ${e}`)
          );
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  static validateToolDefinitions(tools: ToolDefinition[]): ValidationResult {
    const errors: string[] = [];

    if (!tools || tools.length === 0) {
      return { valid: true, errors: [] };
    }

    for (let i = 0; i < tools.length; i++) {
      const tool = tools[i];

      if (!tool.type || tool.type !== 'function') {
        errors.push(`工具${i + 1}: type必须为'function'`);
      }

      if (!tool.function) {
        errors.push(`工具${i + 1}: 缺少function定义`);
        continue;
      }

      if (!tool.function.name) {
        errors.push(`工具${i + 1}: 缺少function.name`);
      }

      if (!tool.function.description) {
        errors.push(`工具${i + 1}: 缺少function.description`);
      }

      if (
        !tool.function.parameters ||
        typeof tool.function.parameters !== 'object'
      ) {
        errors.push(`工具${i + 1}: 缺少或无效的function.parameters`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  static validateToolCalls(toolCalls: any[]): ValidationResult {
    const errors: string[] = [];

    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i];

      if (!tc.id) {
        errors.push(`工具调用${i + 1}: 缺少id`);
      }

      if (!tc.name && !tc.function?.name) {
        errors.push(`工具调用${i + 1}: 缺少工具名称`);
      }

      if (tc.arguments && typeof tc.arguments !== 'object') {
        errors.push(`工具调用${i + 1}: 参数必须是对象`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  static checkContentSafety(content: string): ValidationResult {
    const errors: string[] = [];

    for (const pattern of this.DANGEROUS_PATTERNS) {
      if (pattern.test(content)) {
        errors.push('内容包含可能不安全的模式');
        break;
      }
    }

    return { valid: errors.length === 0, errors };
  }

  static validateMaxTokens(maxTokens: number): ValidationResult {
    const errors: string[] = [];

    if (maxTokens <= 0) {
      errors.push('maxTokens必须大于0');
    }

    if (maxTokens > this.MAX_TOKENS) {
      errors.push(`maxTokens不能超过${this.MAX_TOKENS}`);
    }

    return { valid: errors.length === 0, errors };
  }

  static validateTemperature(temperature: number): ValidationResult {
    const errors: string[] = [];

    if (temperature < 0 || temperature > 2) {
      errors.push('temperature必须在0到2之间');
    }

    return { valid: errors.length === 0, errors };
  }

  static sanitizeContent(content: string): string {
    let sanitized = content;

    for (const pattern of this.DANGEROUS_PATTERNS) {
      sanitized = sanitized.replace(pattern, '');
    }

    return sanitized.trim();
  }
}
