/**
 * plugin-sdk/core.ts - 插件 SDK 核心运行时函数
 *
 * 提供插件开发者使用的运行时工具函数。
 */

import type {
  Plugin,
  PluginContext,
  PluginManifest,
  PluginValidationResult,
  PluginValidationError,
  PluginValidationWarning,
} from './types';

/**
 * 创建插件实例的辅助函数
 * @param definition 插件定义
 * @returns 符合 SDK 标准的 Plugin 对象
 */
export function createPlugin(definition: {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  tags?: string[];
  category: string;
  initialize?: (context: PluginContext) => Promise<void> | void;
  activate?: (context: PluginContext) => Promise<void> | void;
  deactivate?: (context: PluginContext) => Promise<void> | void;
  destroy?: (context: PluginContext) => Promise<void> | void;
  /** T3.3: 热替换清理钩子（可选） */
  __hotDispose?: () => void | Promise<void>;
  skills?: Array<{
    id: string;
    name: string;
    description: string;
    parameters?: Array<{
      name: string;
      type: 'string' | 'number' | 'boolean' | 'array' | 'object';
      description: string;
      required?: boolean;
      defaultValue?: unknown;
    }>;
    execute: (
      context: import('./types').SkillContext,
      args: Record<string, unknown>
    ) => Promise<unknown>;
  }>;
}): Plugin {
  return {
    id: definition.id,
    name: definition.name,
    version: definition.version,
    description: definition.description,
    author: definition.author,
    tags: definition.tags ?? [],
    category: definition.category,
    initialize: definition.initialize,
    activate: definition.activate,
    deactivate: definition.deactivate,
    destroy: definition.destroy,
    __hotDispose: definition.__hotDispose,
    skills: definition.skills,
  };
}

/**
 * 验证插件清单
 */
export function validatePluginManifest(
  manifest: PluginManifest
): PluginValidationResult {
  const errors: PluginValidationError[] = [];
  const warnings: PluginValidationWarning[] = [];

  if (!manifest.id) {
    errors.push({
      code: 'ERR_MISSING_ID',
      message: '插件 ID 不能为空',
      field: 'id',
    });
  } else if (!/^[a-z0-9_-]+$/.test(manifest.id)) {
    errors.push({
      code: 'ERR_INVALID_ID',
      message: '插件 ID 只能包含小写字母、数字、连字符和下划线',
      field: 'id',
    });
  }

  if (!manifest.name) {
    errors.push({
      code: 'ERR_MISSING_NAME',
      message: '插件名称不能为空',
      field: 'name',
    });
  }

  if (!manifest.version) {
    errors.push({
      code: 'ERR_MISSING_VERSION',
      message: '插件版本不能为空',
      field: 'version',
    });
  } else if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    warnings.push({
      code: 'WARN_INVALID_VERSION',
      message: '建议使用语义化版本号 (x.y.z)',
      field: 'version',
    });
  }

  if (!manifest.main) {
    errors.push({
      code: 'ERR_MISSING_MAIN',
      message: '插件入口文件不能为空',
      field: 'main',
    });
  }

  if (manifest.skills) {
    for (const [index, skill] of manifest.skills.entries()) {
      if (!skill.id) {
        errors.push({
          code: 'ERR_MISSING_SKILL_ID',
          message: `技能 #${index + 1} 缺少 ID`,
          field: `skills[${index}].id`,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
