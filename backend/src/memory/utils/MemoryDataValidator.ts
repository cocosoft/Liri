/**
 * Memory数据验证工具
 * 提供记忆数据验证、元数据检查和内容安全过滤
 */

import type { Memory } from '../types/Memory';
import type { MemoryMetadata } from '../types/MemoryMetadata';

export interface MemoryValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface MemoryContentCheckResult {
  safe: boolean;
  sanitized: string;
  issues: string[];
}

/**
 * Memory数据验证器
 */
export class MemoryDataValidator {
  private static readonly MAX_CONTENT_LENGTH = 1000000;
  private static readonly MAX_TAG_LENGTH = 50;
  private static readonly MAX_TAGS = 20;
  private static readonly MAX_NAME_LENGTH = 200;
  private static readonly MAX_DESCRIPTION_LENGTH = 1000;
  private static readonly DANGEROUS_PATTERNS = [
    /<script[\s\S]*?<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /data:/gi,
    /<iframe/gi,
  ];

  /**
   * 验证记忆数据
   */
  static validateMemory(memory: Partial<Memory>): MemoryValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!memory.content || typeof memory.content !== 'string') {
      errors.push('记忆内容不能为空且必须是字符串');
    } else {
      if (memory.content.length > this.MAX_CONTENT_LENGTH) {
        errors.push(
          `记忆内容超过最大长度限制（${this.MAX_CONTENT_LENGTH}字符）`
        );
      }

      if (memory.content.trim() === '') {
        errors.push('记忆内容不能为空');
      }
    }

    if (!memory.metadata) {
      errors.push('记忆缺少元数据');
    } else {
      const metadataValidation = this.validateMetadata(memory.metadata);
      errors.push(...metadataValidation.errors);
      warnings.push(...metadataValidation.warnings);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 验证记忆元数据
   */
  static validateMetadata(
    metadata: Partial<MemoryMetadata>
  ): MemoryValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!metadata.name || typeof metadata.name !== 'string') {
      errors.push('记忆名称不能为空');
    } else {
      if (metadata.name.length > this.MAX_NAME_LENGTH) {
        errors.push(`记忆名称超过最大长度限制（${this.MAX_NAME_LENGTH}字符）`);
      }
    }

    if (
      metadata.description &&
      metadata.description.length > this.MAX_DESCRIPTION_LENGTH
    ) {
      errors.push(
        `记忆描述超过最大长度限制（${this.MAX_DESCRIPTION_LENGTH}字符）`
      );
    }

    if (!metadata.type || typeof metadata.type !== 'string') {
      warnings.push('记忆类型未指定');
    }

    if (metadata.tags) {
      if (!Array.isArray(metadata.tags)) {
        errors.push('标签必须是数组');
      } else {
        if (metadata.tags.length > this.MAX_TAGS) {
          errors.push(`标签数量超过最大限制（${this.MAX_TAGS}个）`);
        }

        for (let i = 0; i < metadata.tags.length; i++) {
          const tag = metadata.tags[i];
          if (typeof tag !== 'string') {
            errors.push(`标签${i + 1}必须是字符串`);
          } else if (tag.length > this.MAX_TAG_LENGTH) {
            errors.push(
              `标签${i + 1}超过最大长度限制（${this.MAX_TAG_LENGTH}字符）`
            );
          }
        }
      }
    }

    if (metadata.priority !== undefined) {
      if (
        typeof metadata.priority !== 'number' ||
        metadata.priority < 0 ||
        metadata.priority > 100
      ) {
        errors.push('优先级必须在0到100之间');
      }
    }

    if (metadata.expiresAt) {
      const expiresDate = new Date(metadata.expiresAt);
      if (isNaN(expiresDate.getTime())) {
        errors.push('过期时间是无效的日期格式');
      } else if (expiresDate <= new Date()) {
        warnings.push('过期时间已过');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 检查记忆内容安全性
   */
  static checkContentSafety(content: string): MemoryContentCheckResult {
    const issues: string[] = [];
    let sanitized = content;

    for (const pattern of this.DANGEROUS_PATTERNS) {
      if (pattern.test(sanitized)) {
        issues.push(`内容包含不安全的模式: ${pattern.toString()}`);
        sanitized = sanitized.replace(pattern, '');
      }
    }

    return {
      safe: issues.length === 0,
      sanitized: sanitized.trim(),
      issues,
    };
  }

  /**
   * 验证标签格式
   */
  static validateTags(tags: string[]): MemoryValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!Array.isArray(tags)) {
      return {
        valid: false,
        errors: ['标签必须是数组'],
        warnings: [],
      };
    }

    if (tags.length > this.MAX_TAGS) {
      errors.push(`标签数量超过最大限制（${this.MAX_TAGS}个）`);
    }

    const tagSet = new Set<string>();
    for (const tag of tags) {
      if (typeof tag !== 'string') {
        errors.push('所有标签必须是字符串');
        continue;
      }

      const trimmedTag = tag.trim().toLowerCase();
      if (trimmedTag === '') {
        errors.push('标签不能为空');
        continue;
      }

      if (trimmedTag.length > this.MAX_TAG_LENGTH) {
        errors.push(`标签超过最大长度限制（${this.MAX_TAG_LENGTH}字符）`);
      }

      if (tagSet.has(trimmedTag)) {
        warnings.push(`重复的标签: ${tag}`);
      }
      tagSet.add(trimmedTag);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 规范化标签
   */
  static normalizeTags(tags: string[]): string[] {
    const normalized: string[] = [];
    const seen = new Set<string>();

    for (const tag of tags) {
      const trimmed = tag.trim().toLowerCase();
      if (trimmed && !seen.has(trimmed)) {
        normalized.push(trimmed);
        seen.add(trimmed);
      }
    }

    return normalized;
  }

  /**
   * 验证团队ID格式
   */
  static validateTeamId(teamId: string): MemoryValidationResult {
    const errors: string[] = [];

    if (!teamId || typeof teamId !== 'string') {
      errors.push('团队ID不能为空');
    } else {
      const teamIdPattern = /^[a-zA-Z0-9_-]+$/;
      if (!teamIdPattern.test(teamId)) {
        errors.push('团队ID只能包含字母、数字、下划线和连字符');
      }

      if (teamId.length > 100) {
        errors.push('团队ID过长');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: [],
    };
  }

  /**
   * 检查记忆内容是否适合存储
   */
  static isContentStorable(content: string): boolean {
    if (!content || typeof content !== 'string') {
      return false;
    }

    if (content.length === 0 || content.length > this.MAX_CONTENT_LENGTH) {
      return false;
    }

    const safetyCheck = this.checkContentSafety(content);
    return safetyCheck.safe;
  }

  /**
   * 获取记忆统计信息
   */
  static getMemoryStats(content: string): {
    charCount: number;
    wordCount: number;
    lineCount: number;
    estimatedTokens: number;
  } {
    const charCount = content.length;
    const wordCount = content.split(/\s+/).filter((w) => w.length > 0).length;
    const lineCount = content.split(/\n/).length;
    const estimatedTokens = Math.ceil(charCount / 4);

    return {
      charCount,
      wordCount,
      lineCount,
      estimatedTokens,
    };
  }

  /**
   * 验证过期时间设置
   */
  static validateExpirySetting(
    expiresAt: Date | undefined,
    retentionDays: number | undefined
  ): MemoryValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (expiresAt) {
      const expiresDate = new Date(expiresAt);
      if (isNaN(expiresDate.getTime())) {
        errors.push('过期时间是无效的日期格式');
      }
    }

    if (retentionDays !== undefined) {
      if (typeof retentionDays !== 'number' || retentionDays <= 0) {
        errors.push('保留天数必须是大于0的数字');
      } else if (retentionDays > 365) {
        warnings.push('保留天数超过一年，可能产生大量数据');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 过滤敏感信息
   */
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
}
