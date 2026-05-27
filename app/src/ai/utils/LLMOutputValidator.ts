/**
 * LLM输出验证工具
 * 提供响应验证、内容过滤和输出安全检查
 */

import type { ChatResponse } from '../models/types';

export interface OutputValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class LLMOutputValidator {
  private static readonly MAX_CONTENT_LENGTH = 100000;
  private static readonly DANGEROUS_KEYWORDS = [
    'eval',
    'exec',
    'compile',
    '__import__',
    'subprocess',
    'os.system',
  ];

  static validateResponse(response: ChatResponse): OutputValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!response) {
      errors.push('响应为空');
      return { valid: false, errors, warnings };
    }

    if (response.content && response.content.length > this.MAX_CONTENT_LENGTH) {
      warnings.push('响应内容过长，可能被截断');
    }

    if (response.tool_calls && response.tool_calls.length > 0) {
      const toolValidation = this.validateToolCalls(response.tool_calls);
      errors.push(...toolValidation.errors);
      warnings.push(...toolValidation.warnings);
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  static validateToolCalls(toolCalls: any[]): OutputValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!toolCalls || !Array.isArray(toolCalls)) {
      errors.push('tool_calls必须是数组');
      return { valid: false, errors, warnings };
    }

    for (const tc of toolCalls) {
      if (!tc.id) {
        errors.push('工具调用缺少id');
      }

      if (!tc.name) {
        errors.push('工具调用缺少name');
      }

      if (tc.arguments && typeof tc.arguments === 'string') {
        try {
          JSON.parse(tc.arguments);
        } catch {
          errors.push('工具调用参数不是有效的JSON');
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  static checkCodeExecutionSafety(
    code: string,
    language: string = 'javascript'
  ): OutputValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (language === 'javascript' || language === 'js') {
      for (const keyword of this.DANGEROUS_KEYWORDS) {
        if (code.includes(keyword)) {
          warnings.push(`代码包含可能危险的关键词: ${keyword}`);
        }
      }

      if (code.includes('Function(') || code.includes('new Function')) {
        warnings.push('代码包含动态函数创建');
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  static filterSensitiveInfo(content: string): string {
    let filtered = content;

    const patterns = [
      /(\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b)/g,
      /(\b\d{3}[-.]?\d{3}[-.]?\d{4}\b)/g,
      /(api[_-]?key|secret|password|token)\s*[:=]\s*['"]?[\w-]+['"]?/gi,
    ];

    for (const pattern of patterns) {
      filtered = filtered.replace(pattern, '[FILTERED]');
    }

    return filtered;
  }

  static validateStopReason(stopReason: string): OutputValidationResult {
    const errors: string[] = [];
    const validReasons = ['stop', 'tool_calls', 'max_tokens'];

    if (!validReasons.includes(stopReason)) {
      errors.push(`无效的stop_reason: ${stopReason}`);
    }

    return { valid: errors.length === 0, errors, warnings: [] };
  }

  static checkURLSafety(content: string): OutputValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const urlPattern = /https?:\/\/[^\s]+/gi;
    const urls = content.match(urlPattern);

    if (urls) {
      for (const url of urls) {
        if (url.startsWith('javascript:') || url.startsWith('data:')) {
          errors.push(`发现危险的URL协议: ${url}`);
        }

        if (url.includes('localhost') || url.includes('127.0.0.1')) {
          warnings.push(`发现本地URL: ${url}`);
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }
}
