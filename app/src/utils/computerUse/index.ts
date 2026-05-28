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
//
/**
 * ComputerUse 模块入口
 *
 * 根据平台自动选择合适的适配器：
 * - win32: WindowsComputerUseAdapter (PowerShell)
 * - darwin: 预留给 macOS 适配器（依赖 Swift 原生模块）
 * - linux: 预留给 Linux 适配器（依赖 X11/Xdotool）
 * - 默认: NoopComputerUseAdapter（告知不支持）
 */

import type { ComputerUseAdapter } from './types';
import { NoopComputerUseAdapter } from './NoopAdapter';

let adapter: ComputerUseAdapter | null = null;

export function getComputerUseAdapter(): ComputerUseAdapter {
  if (adapter) return adapter;

  switch (process.platform) {
    case 'win32':
      try {
        const { WindowsComputerUseAdapter } = require('./WindowsAdapter');
        adapter = new WindowsComputerUseAdapter();
        return adapter!;
      } catch {
        break;
      }
    case 'darwin':
      break;
    case 'linux':
      break;
  }

  return new NoopComputerUseAdapter();
}

export function resetComputerUseAdapter(): void {
  if (adapter) {
    adapter.destroy().catch(() => {});
    adapter = null;
  }
}

export type {
  ComputerUseAdapter,
  ComputerUseCapabilities,
  ScreenshotOptions,
  ScreenshotResult,
  MousePosition,
  MouseAction,
  KeyboardAction,
  AppInfo,
} from './types';

export { NoopComputerUseAdapter } from './NoopAdapter';
