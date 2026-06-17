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
 * 插件类型导出（P0 统一 — 全部从子模块重导出）
 *
 * 核心类型来自 PluginTypes.ts（插件管理基础设施），
 * 插件开发者 API 类型来自 Plugin.ts，
 * 贡献点类型来自 PluginMetadata.ts。
 */

// === 从 PluginTypes.ts 重导出（核心类型） ===
// 注意：不包含 PluginMetadata（与 Plugin.ts 重名冲突），统一使用 Plugin.ts 版本
// PluginState/PluginType/PluginEventType 是 enum（运行时值），统一用 value re-export
export type {
  PluginEvent,
  PluginDependencyResolution,
  PluginConfig,
  PluginRegistration,
  LoadedPlugin,
  PluginLoadResult,
  PluginValidationResult,
} from './PluginTypes.js';
export { PluginState, PluginType, PluginEventType } from './PluginTypes.js';

// === 从 Plugin.ts 重导出（插件开发者 API） ===
export { PluginStatus } from './Plugin.js';
export type {
  PluginDependency,
  PluginContext,
  Plugin,
  PluginManifest,
  PluginMetadata,
} from './Plugin.js';

// === 从 PluginMetadata.ts 重导出（贡献点类型） ===
export type {
  CommandContribution,
  ToolContribution,
  MenuItem,
  MenuContribution,
  SettingContribution,
  PluginMetadata as PluginMetadataExtended,
} from './PluginMetadata.js';

// === 本地特有类型（不冲突） ===
export interface PluginRepository {
  name: string;
  url: string;
  type: 'git' | 'npm' | 'local';
}

// === 从 PluginDisplay.ts 重导出（展示层类型） ===
export type {
  PluginInfo,
  SkillInfo,
  MarketplaceEntry,
  EcosystemConfig,
} from './PluginDisplay.js';
