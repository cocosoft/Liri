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
 * 核心可扩展性系统 — 统一导出
 *
 * 提供插件系统、模块化架构、配置管理和事件总线等功能。
 */

// 类型定义
export {
  PluginState,
  PluginType,
  ModuleType,
  ModuleState,
  EventType,
} from './types.js';
export type {
  PluginMetadata,
  Plugin,
  PluginLoaderOptions,
  ModuleMetadata,
  Module,
  ConfigValue,
  Config,
  EventData,
  EventListener,
} from './types.js';

// 插件加载器
export { PluginLoader, createPluginLoader } from './PluginLoader.js';

// 模块管理
export { ModuleManager, createModuleManager } from './ModuleManager.js';

// 配置管理
export {
  MemoryConfig,
  ConfigManager,
  createConfigManager,
} from './ConfigManager.js';

// 事件总线（重用核心版，弃用本地封装）
export {
  type EventBus,
  createEventBus,
  globalEventBus,
} from '../events/EventBus.js';

// 可扩展性服务
export {
  extensibilityUtils,
  ExtensibilityService,
  getExtensibilityService,
} from './ExtensibilityService.js';

// 默认导出（兼容旧引用）
import {
  getExtensibilityService,
  ExtensibilityService,
} from './ExtensibilityService.js';
import { PluginLoader, createPluginLoader } from './PluginLoader.js';
import { ModuleManager, createModuleManager } from './ModuleManager.js';
import { ConfigManager, createConfigManager } from './ConfigManager.js';
import {
  EventBus,
  createEventBus,
  globalEventBus,
} from '../events/EventBus.js';
import { extensibilityUtils } from './ExtensibilityService.js';
import { PluginState, PluginType, ModuleType, EventType } from './types.js';

export default {
  PluginState,
  PluginType,
  ModuleType,
  ModuleManager,
  ConfigManager,
  EventType,
  extensibilityUtils,
  createPluginLoader,
  createModuleManager,
  createConfigManager,
  createEventBus,
  ExtensibilityService,
  getExtensibilityService,
  globalEventBus,
};
