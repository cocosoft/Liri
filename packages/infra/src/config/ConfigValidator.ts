/**
 * 配置验证器
 * 提供配置验证和类型检查功能
 */

import { GlobalConfig, ConfigValidationRule } from './types.js';

/**
 * 配置验证器类
 */
export class ConfigValidator {
  /**
   * 默认验证规则
   */
  private static readonly DEFAULT_RULES: ConfigValidationRule[] = [
    { key: 'version', type: 'number', required: true },
    { key: 'theme', type: 'string', required: true, default: 'dark' },
    { key: 'verbose', type: 'boolean', required: true, default: false },
    { key: 'editorMode', type: 'string', required: false, default: 'normal' },
    { key: 'diffTool', type: 'string', required: false, default: 'auto' },
    { key: 'env', type: 'object', required: true, default: {} },

    // ===== 分组配置 =====
    { key: 'notifications', type: 'object', required: true, default: {} },
    { key: 'features', type: 'object', required: true, default: {} },
    { key: 'internal', type: 'object', required: true, default: {} },

    // 2026-10-06（P2-8 ② 配置字段迁移收尾）：原 14 条「向后兼容的已废弃字段」
    // （`numStartups` / `preferredNotifChannel` / `autoCompactEnabled` / `showTurnDuration` /
    //  `tipsHistory` / `cachedStatsigGates` …）规则已删除 —— 这些扁平键已由
    // `ConfigMigration.migrateToV2` 折入 `notifications`/`features`/`internal` 并清除，
    // 保留只会对「不存在的键」做无意义校验（`required:false` 且未定义即跳过 ⇒ 从来只空转）。
  ];

  /**
   * 验证配置
   * @param config 配置对象
   * @param customRules 自定义验证规则
   * @returns 验证结果
   */
  static validate(
    config: GlobalConfig,
    customRules?: ConfigValidationRule[]
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const rules = customRules || this.DEFAULT_RULES;

    for (const rule of rules) {
      const value = config[rule.key];

      // 检查必填字段
      if (rule.required && value === undefined) {
        errors.push(`缺少必填配置项: ${rule.key}`);
        continue;
      }

      // 如果值为undefined且不是必填的，跳过验证
      if (value === undefined) {
        continue;
      }

      // 检查类型
      const actualType = this.getType(value);
      if (actualType !== rule.type) {
        errors.push(
          `配置项 ${rule.key} 类型错误: 期望 ${rule.type}, 实际 ${actualType}`
        );
        continue;
      }

      // 自定义验证
      if (rule.validate && !rule.validate(value)) {
        errors.push(rule.message || `配置项 ${rule.key} 值无效`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * 获取值的类型
   * @param value 值
   * @returns 类型字符串
   */
  private static getType(value: unknown): string {
    if (Array.isArray(value)) {
      return 'array';
    }
    if (value === null) {
      return 'null';
    }
    return typeof value;
  }

  /**
   * 验证主题值
   * @param value 主题值
   * @returns 是否有效
   */
  static isValidTheme(value: string): boolean {
    return ['dark', 'light', 'system'].includes(value);
  }

  /**
   * 验证编辑器模式
   * @param value 编辑器模式
   * @returns 是否有效
   */
  static isValidEditorMode(value: string): boolean {
    return ['normal', 'vim', 'emacs'].includes(value);
  }

  /**
   * 验证通知渠道
   * @param value 通知渠道
   * @returns 是否有效
   */
  static isValidNotificationChannel(value: string): boolean {
    return ['auto', 'native', 'none'].includes(value);
  }

  /**
   * 验证差异工具
   * @param value 差异工具
   * @returns 是否有效
   */
  static isValidDiffTool(value: string): boolean {
    return ['terminal', 'auto'].includes(value);
  }

  /**
   * 使用默认值修正配置
   * @param config 配置对象
   * @returns 修正后的配置
   */
  static fixWithDefaults(config: GlobalConfig): GlobalConfig {
    const fixed = { ...config };

    for (const rule of this.DEFAULT_RULES) {
      if (rule.default !== undefined && fixed[rule.key] === undefined) {
        (fixed as Record<string, unknown>)[rule.key] = rule.default;
      }
    }

    return fixed;
  }
}
