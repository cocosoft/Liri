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
 * Landlock 配置（P2，2026-08-25）
 *
 * 配置键（config.json，点号路径）：
 * - `sandbox.landlock.enabled`  （默认 true）  总开关；关闭则完全走本地执行路径
 * - `sandbox.landlock.failClosed`（默认 false）沙箱初始化失败（exit 125）时拒绝而非回退
 *
 * 决策：兼容优先（2026-08-25 用户确认）——failClosed 默认 false；
 * 无 Landlock 内核/helper 缺失时始终回退（enabled 仅控制"是否尝试 Landlock 路径"）。
 */
import { configManager } from '@modules/config';

export interface LandlockConfig {
  enabled: boolean;
  failClosed: boolean;
}

/** 默认配置（兼容优先） */
export const DEFAULT_LANDLOCK_CONFIG: LandlockConfig = {
  enabled: true,
  failClosed: false,
};

/** 纯函数：应用默认值（可单测） */
export function resolveLandlockConfig(
  raw?: Partial<LandlockConfig>
): LandlockConfig {
  return {
    enabled: raw?.enabled ?? DEFAULT_LANDLOCK_CONFIG.enabled,
    failClosed: raw?.failClosed ?? DEFAULT_LANDLOCK_CONFIG.failClosed,
  };
}

/** 从 config.json 读取 Landlock 配置 */
export function readLandlockConfig(): LandlockConfig {
  const enabled = configManager.getValue<boolean>('sandbox.landlock.enabled');
  const failClosed = configManager.getValue<boolean>(
    'sandbox.landlock.failClosed'
  );
  return resolveLandlockConfig({ enabled, failClosed });
}
