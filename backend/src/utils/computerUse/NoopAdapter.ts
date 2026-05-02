/**
 * ComputerUse 无操作适配器（默认回退）
 *
 * 在不支持的平台上返回明确的能力信息，
 * 所有操作返回友好的错误提示。
 */

import type {
  ComputerUseAdapter,
  ComputerUseCapabilities,
  ScreenshotResult,
  ScreenshotOptions,
  MousePosition,
  MouseAction,
  KeyboardAction,
  AppInfo,
} from './types'

const NOOP_CAPABILITIES: ComputerUseCapabilities = {
  screenshot: false,
  mouseControl: false,
  keyboardControl: false,
  clipboardAccess: false,
  appManagement: false,
  platform: process.platform as ComputerUseCapabilities['platform'],
}

export class NoopComputerUseAdapter implements ComputerUseAdapter {
  readonly capabilities: ComputerUseCapabilities = NOOP_CAPABILITIES

  isSupported(): boolean {
    return false
  }

  async takeScreenshot(_options?: ScreenshotOptions): Promise<ScreenshotResult> {
    throw new Error('ComputerUse is not supported on this platform')
  }

  async getDisplayGeometry(): Promise<{ width: number; height: number; scaleFactor: number }> {
    throw new Error('ComputerUse is not supported on this platform')
  }

  async mouseAction(_action: MouseAction): Promise<void> {
    throw new Error('ComputerUse is not supported on this platform')
  }

  async getMousePosition(): Promise<MousePosition> {
    throw new Error('ComputerUse is not supported on this platform')
  }

  async keyboardAction(_action: KeyboardAction): Promise<void> {
    throw new Error('ComputerUse is not supported on this platform')
  }

  async getClipboard(): Promise<string> {
    throw new Error('ComputerUse is not supported on this platform')
  }

  async setClipboard(_text: string): Promise<void> {
    throw new Error('ComputerUse is not supported on this platform')
  }

  async getRunningApps(): Promise<AppInfo[]> {
    throw new Error('ComputerUse is not supported on this platform')
  }

  async getFrontmostApp(): Promise<AppInfo | null> {
    throw new Error('ComputerUse is not supported on this platform')
  }

  async launchApp(_bundleIdOrPath: string): Promise<boolean> {
    throw new Error('ComputerUse is not supported on this platform')
  }

  async activateApp(_bundleId: string): Promise<boolean> {
    throw new Error('ComputerUse is not supported on this platform')
  }

  async destroy(): Promise<void> {}
}
