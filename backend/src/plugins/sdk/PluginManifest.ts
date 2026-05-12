/**
 * PluginManifest — 插件清单类型定义
 *
 * 定义第三方插件的 package.json 中 "pyapp" 字段的结构。
 * 插件开发者通过此清单声明插件元数据、入口点和依赖。
 */

/** 插件清单（位于 package.json 的 "pyapp" 字段） */
export interface PluginManifest {
  /** 插件唯一标识符（推荐使用 npm 包名） */
  id: string;

  /** 插件显示名称 */
  name: string;

  /** 语义化版本号 */
  version: string;

  /** 插件描述 */
  description: string;

  /** 作者信息 */
  author: string;

  /** 插件类型 */
  type: PluginType;

  /** 入口文件（相对于插件根目录） */
  main: string;

  /** 最低 PY_APP 版本要求 */
  engine?: string;

  /** 依赖的其他插件 ID 列表 */
  dependencies?: string[];

  /** 可选依赖 */
  optionalDependencies?: string[];

  /** 标签 */
  keywords?: string[];

  /** 主页 URL */
  homepage?: string;

  /** 许可证 */
  license?: string;

  /** 图标路径 */
  icon?: string;

  /** 插件提供的技能列表 */
  skills?: PluginSkillManifest[];

  /** 插件提供的 Hook 列表 */
  hooks?: PluginHookManifest[];

  /** 插件配置 schema（JSON Schema 格式） */
  configSchema?: Record<string, unknown>;
}

/** 插件类型枚举 */
export enum PluginType {
  TOOL = 'tool',
  THEME = 'theme',
  LANGUAGE = 'language',
  INTEGRATION = 'integration',
  UTILITY = 'utility',
  CUSTOM = 'custom',
}

/** 技能清单 */
export interface PluginSkillManifest {
  /** 技能唯一标识 */
  id: string;

  /** 技能名称 */
  name: string;

  /** 技能描述 */
  description: string;

  /** 技能参数定义 */
  parameters?: PluginSkillParameter[];

  /** 入口函数名（默认 "execute"） */
  entryFunction?: string;
}

/** 技能参数 */
export interface PluginSkillParameter {
  /** 参数名 */
  name: string;

  /** 参数类型 */
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';

  /** 参数描述 */
  description: string;

  /** 是否必填 */
  required?: boolean;

  /** 默认值 */
  defaultValue?: unknown;

  /** 枚举值（仅 string 类型） */
  enum?: string[];
}

/** Hook 清单 */
export interface PluginHookManifest {
  /** Hook 名称 */
  name: string;

  /** Hook 阶段 */
  phase: 'before' | 'after' | 'onError';

  /** 入口函数名 */
  entryFunction: string;

  /** 优先级（数字越小越先执行） */
  priority?: number;
}

/** 插件验证结果 */
export interface PluginValidationResult {
  /** 是否通过验证 */
  valid: boolean;

  /** 错误列表 */
  errors: PluginValidationError[];

  /** 警告列表 */
  warnings: PluginValidationWarning[];
}

/** 验证错误 */
export interface PluginValidationError {
  /** 错误码 */
  code: string;

  /** 错误消息 */
  message: string;

  /** 相关字段 */
  field?: string;
}

/** 验证警告 */
export interface PluginValidationWarning {
  /** 警告码 */
  code: string;

  /** 警告消息 */
  message: string;

  /** 相关字段 */
  field?: string;
}