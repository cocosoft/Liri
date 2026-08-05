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
 * 环境变量注入配置
 * 提供启动时从环境变量注入配置的统一入口
 */

import type { ConfigManager } from './ConfigManager.js';

/**
 * 从 LIRI_TRUSTED_WORKSPACE 环境变量注入信任工作区配置
 * 仅合并 trustedWorkspaces 字段，不整体覆盖 permission（保留 mode/customRules 等已有配置）
 * 仅在 config 中尚无 trustedWorkspaces 时注入
 * @param configManager 配置管理器
 */
export function injectTrustedWorkspaceFromEnv(
  configManager: ConfigManager
): void {
  const trustedWorkspace = configManager.env('LIRI_TRUSTED_WORKSPACE');
  if (!trustedWorkspace) {
    return;
  }

  // 支持语法扩展：LIRI_TRUSTED_WORKSPACE=path|level
  let wsPath = trustedWorkspace;
  let wsLevel: string = 'development';
  const pipeIdx = trustedWorkspace.lastIndexOf('|');
  if (pipeIdx > 0) {
    wsPath = trustedWorkspace.slice(0, pipeIdx);
    wsLevel = trustedWorkspace.slice(pipeIdx + 1);
  }

  const existing = (configManager.getConfigValue<Record<string, unknown>>(
    'permission'
  ) ?? {}) as Record<string, unknown>;
  const existingTrusted = existing.trustedWorkspaces;
  if (Array.isArray(existingTrusted) && existingTrusted.length > 0) {
    return;
  }

  configManager.setConfigValue('permission', {
    ...existing,
    trustedWorkspaces: [{ path: wsPath, trustLevel: wsLevel, enabled: true }],
  });
}
