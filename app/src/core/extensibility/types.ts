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
 * 可扩展性系统 — 类型定义
 *
 * 插件/模块/配置/事件的共享类型、接口和枚举。
 */

/**
 * 插件生命周期状态
 */
export enum PluginState {
  UNLOADED = 'unloaded',
  LOADING = 'loading',
  LOADED = 'loaded',
  ACTIVATED = 'activated',
  DEACTIVATED = 'deactivated',
  FAILED = 'failed',
}

/**
 * 插件类型
 */
export enum PluginType {
  CORE = 'core',
  EXTENSION = 'extension',
  THEME = 'theme',
  SERVICE = 'service',
  CUSTOM = 'custom',
}

/**
 * 插件元数据
 */
export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  type: PluginType;
  dependencies?: string[];
  main?: string;
  entryPoint?: string;
  icon?: string;
  homepage?: string;
  license?: string;
  keywords?: string[];
  [key: string]: unknown;
}

/**
 * 插件接口
 */
export interface Plugin {
  metadata: PluginMetadata;
  state: PluginState;
  instance?: unknown;
  error?: string;
  load(): Promise<void>;
  unload(): Promise<void>;
  activate(): Promise<void>;
  deactivate(): Promise<void>;
}

/**
 * 插件加载器选项
 */
export interface PluginLoaderOptions {
  pluginDirectories?: string[];
  autoLoad?: boolean;
  autoActivate?: boolean;
  validationEnabled?: boolean;
  cacheEnabled?: boolean;
}

/**
 * 模块类型
 */
export enum ModuleType {
  CORE = 'core',
  PLUGIN = 'plugin',
  EXTENSION = 'extension',
  SERVICE = 'service',
  COMPONENT = 'component',
  UTILITY = 'utility',
  CUSTOM = 'custom',
}

/**
 * 模块元数据
 */
export interface ModuleMetadata {
  id: string;
  name: string;
  version: string;
  description: string;
  type: ModuleType;
  dependencies?: string[];
  providers?: string[];
  exports?: string[];
  [key: string]: unknown;
}

/**
 * 模块状态
 */
export enum ModuleState {
  UNLOADED = 'unloaded',
  LOADING = 'loading',
  LOADED = 'loaded',
  ACTIVATED = 'activated',
  DEACTIVATED = 'deactivated',
  FAILED = 'failed',
}

/**
 * 模块接口
 */
export interface Module {
  metadata: ModuleMetadata;
  state: ModuleState;
  providers: Map<string, any>;
  init(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  destroy(): Promise<void>;
  getProvider<T>(name: string): T | undefined;
  registerProvider(name: string, provider: unknown): void;
  unregisterProvider(name: string): void;
}

/**
 * 配置值类型
 */
export type ConfigValue = string | number | boolean | object | null | undefined;

/**
 * 配置接口
 */
export interface Config {
  get<T extends ConfigValue>(key: string, defaultValue?: T): T;
  set(key: string, value: ConfigValue): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  clear(): void;
  toObject(): Record<string, ConfigValue>;
  fromObject(config: Record<string, ConfigValue>): void;
  load(): Promise<void>;
  save(): Promise<void>;
}

/**
 * 事件类型
 */
export enum EventType {
  PLUGIN_LOADED = 'plugin_loaded',
  PLUGIN_UNLOADED = 'plugin_unloaded',
  PLUGIN_ACTIVATED = 'plugin_activated',
  PLUGIN_DEACTIVATED = 'plugin_deactivated',
  MODULE_REGISTERED = 'module_registered',
  MODULE_UNREGISTERED = 'module_unregistered',
  CONFIG_CHANGED = 'config_changed',
  SYSTEM_START = 'system_start',
  SYSTEM_STOP = 'system_stop',
  ERROR = 'error',
  WARNING = 'warning',
  INFO = 'info',
  DEBUG = 'debug',
  CUSTOM = 'custom',
}

/**
 * 事件数据
 */
export interface EventData {
  type: EventType;
  timestamp: number;
  data?: unknown;
  source?: string;
  [key: string]: unknown;
}

/**
 * 事件监听器类型
 */
export type EventListener = (event: EventData) => void;
