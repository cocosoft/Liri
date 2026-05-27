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
