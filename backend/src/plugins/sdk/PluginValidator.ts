/**
 * PluginValidator — 插件验证器
 *
 * 在插件注册前验证清单完整性、依赖可用性和版本兼容性。
 */

import type {
  PluginManifest,
  PluginValidationResult,
  PluginValidationError,
  PluginValidationWarning,
} from './PluginManifest';

/** 验证选项 */
export interface PluginValidatorOptions {
  /** 已注册的插件 ID 列表（用于依赖检查） */
  registeredPlugins?: string[];

  /** 当前 PY_APP 版本（用于引擎版本检查） */
  engineVersion?: string;

  /** 是否严格模式（警告也视为错误） */
  strict?: boolean;
}

/** 插件验证器 */
export class PluginValidator {
  private registeredPlugins: Set<string>;
  private engineVersion: string;
  private strict: boolean;

  constructor(options: PluginValidatorOptions = {}) {
    this.registeredPlugins = new Set(options.registeredPlugins || []);
    this.engineVersion = options.engineVersion || '0.0.0';
    this.strict = options.strict || false;
  }

  /** 验证插件清单 */
  validate(manifest: PluginManifest): PluginValidationResult {
    const errors: PluginValidationError[] = [];
    const warnings: PluginValidationWarning[] = [];

    this.validateRequired(manifest, errors);
    this.validateId(manifest, errors);
    this.validateVersion(manifest, errors);
    this.validateEngine(manifest, errors, warnings);
    this.validateDependencies(manifest, errors, warnings);
    this.validateSkills(manifest, errors, warnings);
    this.validateHooks(manifest, errors, warnings);

    if (this.strict && warnings.length > 0) {
      for (const warning of warnings) {
        errors.push({
          code: 'STRICT_WARNING',
          message: `[严格模式] ${warning.message}`,
          field: warning.field,
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: this.strict ? [] : warnings,
    };
  }

  /** 验证必填字段 */
  private validateRequired(manifest: PluginManifest, errors: PluginValidationError[]): void {
    const required: Array<{ field: keyof PluginManifest; label: string }> = [
      { field: 'id', label: '插件 ID' },
      { field: 'name', label: '插件名称' },
      { field: 'version', label: '版本号' },
      { field: 'description', label: '描述' },
      { field: 'author', label: '作者' },
      { field: 'type', label: '插件类型' },
      { field: 'main', label: '入口文件' },
    ];

    for (const { field, label } of required) {
      if (!manifest[field]) {
        errors.push({
          code: 'MISSING_REQUIRED',
          message: `缺少必填字段: ${label}`,
          field,
        });
      }
    }
  }

  /** 验证插件 ID 格式 */
  private validateId(manifest: PluginManifest, errors: PluginValidationError[]): void {
    if (!manifest.id) return;

    const idPattern = /^[a-z0-9][a-z0-9._-]*[a-z0-9]$/i;

    if (!idPattern.test(manifest.id)) {
      errors.push({
        code: 'INVALID_ID',
        message: `插件 ID "${manifest.id}" 格式无效。只允许字母、数字、点、下划线和连字符`,
        field: 'id',
      });
    }

    if (manifest.id.length > 100) {
      errors.push({
        code: 'ID_TOO_LONG',
        message: `插件 ID 长度不能超过 100 个字符`,
        field: 'id',
      });
    }
  }

  /** 验证版本号格式 */
  private validateVersion(manifest: PluginManifest, errors: PluginValidationError[]): void {
    if (!manifest.version) return;

    const semverPattern = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/;

    if (!semverPattern.test(manifest.version)) {
      errors.push({
        code: 'INVALID_VERSION',
        message: `版本号 "${manifest.version}" 不符合语义化版本规范`,
        field: 'version',
      });
    }
  }

  /** 验证引擎版本兼容性 */
  private validateEngine(
    manifest: PluginManifest,
    errors: PluginValidationError[],
    warnings: PluginValidationWarning[],
  ): void {
    if (!manifest.engine) {
      warnings.push({
        code: 'NO_ENGINE',
        message: '未声明最低引擎版本，建议添加 engine 字段',
        field: 'engine',
      });
      return;
    }

    if (!this.isVersionCompatible(manifest.engine, this.engineVersion)) {
      errors.push({
        code: 'ENGINE_INCOMPATIBLE',
        message: `插件要求引擎版本 >= ${manifest.engine}，当前版本为 ${this.engineVersion}`,
        field: 'engine',
      });
    }
  }

  /** 验证依赖 */
  private validateDependencies(
    manifest: PluginManifest,
    errors: PluginValidationError[],
    warnings: PluginValidationWarning[],
  ): void {
    if (!manifest.dependencies || manifest.dependencies.length === 0) return;

    for (const dep of manifest.dependencies) {
      if (!this.registeredPlugins.has(dep)) {
        errors.push({
          code: 'MISSING_DEPENDENCY',
          message: `依赖插件 "${dep}" 未注册`,
          field: 'dependencies',
        });
      }
    }

    if (manifest.dependencies.length > 20) {
      warnings.push({
        code: 'MANY_DEPENDENCIES',
        message: `插件声明了 ${manifest.dependencies.length} 个依赖，建议精简`,
        field: 'dependencies',
      });
    }
  }

  /** 验证技能定义 */
  private validateSkills(
    manifest: PluginManifest,
    errors: PluginValidationError[],
    warnings: PluginValidationWarning[],
  ): void {
    if (!manifest.skills || manifest.skills.length === 0) return;

    const skillIds = new Set<string>();

    for (const skill of manifest.skills) {
      if (!skill.id || !skill.name || !skill.description) {
        errors.push({
          code: 'INVALID_SKILL',
          message: `技能 "${skill.name || '(未命名)'}" 缺少必填字段`,
          field: 'skills',
        });
        continue;
      }

      if (skillIds.has(skill.id)) {
        errors.push({
          code: 'DUPLICATE_SKILL',
          message: `技能 ID "${skill.id}" 重复`,
          field: 'skills',
        });
      }

      skillIds.add(skill.id);

      if (skill.parameters) {
        for (const param of skill.parameters) {
          if (!param.name || !param.type || !param.description) {
            warnings.push({
              code: 'INVALID_SKILL_PARAM',
              message: `技能 "${skill.name}" 的参数 "${param.name || '(未命名)'}" 缺少必填字段`,
              field: 'skills',
            });
          }
        }
      }
    }
  }

  /** 验证 Hook 定义 */
  private validateHooks(
    manifest: PluginManifest,
    errors: PluginValidationError[],
    warnings: PluginValidationWarning[],
  ): void {
    if (!manifest.hooks || manifest.hooks.length === 0) return;

    const validPhases = ['before', 'after', 'onError'];

    for (const hook of manifest.hooks) {
      if (!hook.name || !hook.entryFunction) {
        errors.push({
          code: 'INVALID_HOOK',
          message: `Hook "${hook.name || '(未命名)'}" 缺少必填字段`,
          field: 'hooks',
        });
        continue;
      }

      if (!validPhases.includes(hook.phase)) {
        errors.push({
          code: 'INVALID_HOOK_PHASE',
          message: `Hook "${hook.name}" 的阶段 "${hook.phase}" 无效，有效值: ${validPhases.join(', ')}`,
          field: 'hooks',
        });
      }
    }
  }

  /** 简单的语义化版本比较 */
  private isVersionCompatible(required: string, current: string): boolean {
    try {
      const reqParts = required.split('.');
      const curParts = current.split('.');

      for (let i = 0; i < Math.max(reqParts.length, curParts.length); i++) {
        const req = parseInt(reqParts[i] || '0', 10);
        const cur = parseInt(curParts[i] || '0', 10);

        if (cur > req) return true;
        if (cur < req) return false;
      }

      return true;
    } catch {
      return false;
    }
  }
}