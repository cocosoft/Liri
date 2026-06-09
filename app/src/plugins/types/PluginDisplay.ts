/**
 * 插件展示类型定义
 * 用于 UI 展示层的轻量级数据视图，与 PluginTypes.ts 的核心类型分离
 */

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
 * 插件信息（展示层）
 */
export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  tags: string[];
  category: string;
  rating?: number;
  downloads?: number;
  installed?: boolean;
  enabled?: boolean;
  path?: string;
  entryPoint?: string;
}

/**
 * 技能信息（展示层）
 */
export interface SkillInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  tags: string[];
  category: string;
  pluginId?: string;
  rating?: number;
  usageCount?: number;
  installed?: boolean;
  enabled?: boolean;
  path?: string;
}

/**
 * 插件市场条目
 */
export interface MarketplaceEntry {
  plugin: PluginInfo;
  skills: SkillInfo[];
  lastUpdated: string;
  size: string;
  dependencies: string[];
}

/**
 * 生态系统配置
 */
export interface EcosystemConfig {
  marketplaceUrl?: string;
  localPluginPath?: string;
  localSkillPath?: string;
  autoUpdate?: boolean;
  allowThirdParty?: boolean;
}
