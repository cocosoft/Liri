/**
 * 记忆内容净化器（3 层清理）
 * 对标 Hermes sanitize_context 3 层清理机制
 */
import { getContextFence } from './ContextFence';

/**
 * 净化层级
 */
export type SanitizeLevel = 'basic' | 'standard' | 'strict';

/**
 * 净化结果
 */
export interface SanitizeResult {
  output: string;
  changed: boolean;
  removedLines: number;
  warnings: string[];
}

/**
 * 记忆净化器
 */
export class MemorySanitizer {
  /**
   * 3 层净化
   * @param content 原始内容
   * @param level 净化层级
   * @returns 净化结果
   */
  sanitize(content: string, level: SanitizeLevel = 'standard'): SanitizeResult {
    let output = content;
    const warnings: string[] = [];
    let removedLines = 0;

    const lineCountBefore = output.split('\n').length;

    output = this.sanitizeBasic(output, level, warnings);

    if (level === 'standard' || level === 'strict') {
      output = this.sanitizeStandard(output, warnings);
    }

    if (level === 'strict') {
      output = this.sanitizeStrict(output, warnings);
    }

    const lineCountAfter = output.split('\n').length;
    removedLines = Math.max(0, lineCountBefore - lineCountAfter);

    return {
      output,
      changed: content !== output,
      removedLines,
      warnings,
    };
  }

  /**
   * 第 1 层：基础清理
   * 移除空行、控制字符、过长的行
   */
  private sanitizeBasic(
    content: string,
    _level: SanitizeLevel,
    warnings: string[]
  ): string {
    let result = content;

    const ctrlCharCount = (
      result.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g) || []
    ).length;
    if (ctrlCharCount > 0) {
      result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
      warnings.push(`移除了 ${ctrlCharCount} 个控制字符`);
    }

    const lines = result.split('\n');
    const cleanedLines = lines.filter((line) => {
      if (line.length > 5000) {
        warnings.push(`截断了过长行（${line.length} 字符）`);
        return false;
      }

      return true;
    });

    result = cleanedLines.join('\n');

    result = result.replace(/\n{3,}/g, '\n\n');

    return result;
  }

  /**
   * 第 2 层：标准清理
   * 移除已知的敏感模式和潜在危害内容
   */
  private sanitizeStandard(content: string, warnings: string[]): string {
    let result = content;

    const patterns = [
      {
        pattern:
          /-----BEGIN (\w+ )?PRIVATE KEY-----[\s\S]*?-----END (\w+ )?PRIVATE KEY-----/g,
        label: '私钥块',
      },
      { pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, label: 'Bearer Token' },
      {
        pattern: /ghp_[A-Za-z0-9]{36}/g,
        label: 'GitHub Personal Access Token',
      },
      { pattern: /sk-[A-Za-z0-9]{32,}/g, label: 'OpenAI API Key' },
    ];

    for (const { pattern, label } of patterns) {
      const matches = result.match(pattern);
      if (matches && matches.length > 0) {
        result = result.replace(pattern, `[${label} 已移除]`);
        warnings.push(`移除了 ${matches.length} 个 ${label}`);
      }
    }

    result = this.stripNestedFencesNormalized(result);

    return result;
  }

  /**
   * 第 3 层：严格清理
   * 额外检查和限制
   */
  private sanitizeStrict(content: string, warnings: string[]): string {
    let result = content;

    const urlCount = (result.match(/https?:\/\/[^\s]+/g) || []).length;
    if (urlCount > 20) {
      result = result.replace(/https?:\/\/[^\s]+/g, (_match, idx) => {
        return idx < 20 ? _match : '[URL 已移除]';
      });
      warnings.push(`截断了 ${urlCount - 20} 个 URL`);
    }

    const lineCount = result.split('\n').length;
    const maxLines = 200;
    if (lineCount > maxLines) {
      const lines = result.split('\n');
      result = lines.slice(0, maxLines).join('\n');
      warnings.push(
        `截断了 ${lineCount - maxLines} 行（超过 ${maxLines} 行限制）`
      );
    }

    return result;
  }

  /**
   * 剥离嵌套篱笆
   */
  private stripNestedFencesNormalized(content: string): string {
    return getContextFence().stripFences(content);
  }

  /**
   * 创建安全的提示内容
   * @param memoryContext 记忆上下文
   * @param level 净化层级
   * @returns 安全的提示内容
   */
  createSafePromptContent(
    memoryContext: string,
    level: SanitizeLevel = 'standard'
  ): string {
    const result = this.sanitize(memoryContext, level);

    if (result.changed) {
      result.output = `[已清理记忆上下文，移除 ${result.removedLines} 行]\n\n${result.output}`;
    }

    return getContextFence().wrap(result.output);
  }
}
