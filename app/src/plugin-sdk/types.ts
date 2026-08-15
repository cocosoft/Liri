// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * plugin-sdk/types.ts - 插件 SDK 公开类型定义
 *
 * 为第三方插件开发者提供的所有公开类型。
 * 此目录不引用任何核心模块，保持独立纯净。
 */

/** 插件上下文 — 运行时注入给插件的 API 接口 */
export interface PluginContext {
  pluginId: string;
  pluginName: string;
  version: string;

  log: {
    debug: (message: string, ...args: unknown[]) => void;
    info: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
  };

  config: {
    get: <T>(key: string, defaultValue?: T) => T;
    set: <T>(key: string, value: T) => void;
    save: () => Promise<void>;
  };

  events: {
    on: (event: string, callback: (...args: unknown[]) => void) => void;
    off: (event: string, callback: (...args: unknown[]) => void) => void;
    emit: (event: string, ...args: unknown[]) => void;
  };

  utils: {
    showNotification: (
      message: string,
      type?: 'info' | 'success' | 'warning' | 'error'
    ) => void;
    showProgress: (label: string, current: number, total: number) => void;
  };
}

/** 技能上下文 */
export interface SkillContext {
  pluginId: string;
  skillId: string;
  log: {
    debug: (message: string, ...args: unknown[]) => void;
    info: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
  };
}

/** 技能参数定义 */
export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  defaultValue?: unknown;
}

/** 技能定义 */
export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  parameters?: SkillParameter[];
  execute: (
    context: SkillContext,
    args: Record<string, unknown>
  ) => Promise<unknown>;
}

/** 插件定义 */
export interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  tags: string[];
  category: string;

  initialize?: (context: PluginContext) => Promise<void> | void;
  activate?: (context: PluginContext) => Promise<void> | void;
  deactivate?: (context: PluginContext) => Promise<void> | void;
  destroy?: (context: PluginContext) => Promise<void> | void;

  /**
   * T3.3: 热替换清理钩子（可选）。
   * destroy 无法回收模块级全局状态（require.cache、全局监听器、setInterval），
   * 插件声明 __hotDispose() 显式清理。未声明者默认保守拒绝热替换（保留旧版本）。
   */
  __hotDispose?: () => void | Promise<void>;

  skills?: SkillDefinition[];
}

/** 插件配置 */
export interface PluginConfig {
  [key: string]: unknown;
}

/** 插件运行时 — 插件实例的运行时封装 */
export interface PluginRuntime {
  plugin: Plugin;
  context: PluginContext;
  status: PluginRuntimeStatus;
  startedAt?: number;
}

/** 插件运行时状态 */
export enum PluginRuntimeStatus {
  CREATED = 'created',
  INITIALIZING = 'initializing',
  ACTIVE = 'active',
  DEACTIVATING = 'deactivating',
  INACTIVE = 'inactive',
  ERROR = 'error',
}

/** 工具注册信息 */
export interface ToolRegistration {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
  pluginId?: string;
}

/** 插件清单（位于 package.json 的 "pyapp" 字段） */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  type: string;
  main: string;
  engine?: string;
  dependencies?: string[];
  optionalDependencies?: string[];
  keywords?: string[];
  homepage?: string;
  license?: string;
  icon?: string;
  skills?: PluginSkillManifest[];
  hooks?: PluginHookManifest[];
  configSchema?: Record<string, unknown>;
}

/** 技能清单 */
export interface PluginSkillManifest {
  id: string;
  name: string;
  description: string;
  parameters?: PluginSkillParameter[];
  entryFunction?: string;
}

/** 技能参数清单 */
export interface PluginSkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  defaultValue?: unknown;
  enum?: string[];
}

/** Hook 清单 */
export interface PluginHookManifest {
  name: string;
  phase: 'before' | 'after' | 'onError';
  entryFunction: string;
  priority?: number;
}

/** 验证结果 */
export interface PluginValidationResult {
  valid: boolean;
  errors: PluginValidationError[];
  warnings: PluginValidationWarning[];
}

/** 验证错误 */
export interface PluginValidationError {
  code: string;
  message: string;
  field?: string;
}

/** 验证警告 */
export interface PluginValidationWarning {
  code: string;
  message: string;
  field?: string;
}
