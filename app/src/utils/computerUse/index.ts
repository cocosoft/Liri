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
 * - darwin: MacComputerUseAdapter (osascript/screencapture)
 * - linux: LinuxComputerUseAdapter (xdotool/xclip/ImageMagick)
 * - 默认: NoopComputerUseAdapter（告知不支持）
 */

import type { ComputerUseAdapter } from './types';
import { NoopComputerUseAdapter } from './NoopAdapter';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'utils:computerUse:index',
  level: LogLevel.INFO,
});

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
      try {
        const { MacComputerUseAdapter } = require('./MacAdapter');
        adapter = new MacComputerUseAdapter();
        return adapter!;
      } catch {
        break;
      }
    case 'linux':
      try {
        const { LinuxComputerUseAdapter } = require('./LinuxAdapter');
        adapter = new LinuxComputerUseAdapter();
        return adapter!;
      } catch {
        break;
      }
  }

  return new NoopComputerUseAdapter();
}

export function resetComputerUseAdapter(): void {
  if (adapter) {
    // @ignore-catch — 销毁适配器best-effort，失败不影响引用置空
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
