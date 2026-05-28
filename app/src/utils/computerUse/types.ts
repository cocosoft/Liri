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
 * ComputerUse 跨平台抽象接口
 *
 * 提供桌面自动化能力（截图、鼠标、键盘、应用管理）的抽象层。
 * 具体实现由平台适配器提供：
 * - macOS: 通过 Swift 原生 API
 * - Windows: 通过 Win32 API 或 PowerShell
 * - Linux: 通过 X11/Xdotool
 */

export interface ComputerUseCapabilities {
  screenshot: boolean;
  mouseControl: boolean;
  keyboardControl: boolean;
  clipboardAccess: boolean;
  appManagement: boolean;
  platform: 'darwin' | 'win32' | 'linux' | 'unknown';
}

export interface ScreenshotOptions {
  quality?: number; // JPEG quality 0-1, default 0.75
  maxWidth?: number;
  maxHeight?: number;
  region?: { x: number; y: number; width: number; height: number };
}

export interface ScreenshotResult {
  data: Buffer;
  format: 'jpeg' | 'png';
  width: number;
  height: number;
}

export interface MousePosition {
  x: number;
  y: number;
}

export interface MouseAction {
  type: 'move' | 'click' | 'doubleClick' | 'rightClick' | 'scroll';
  x?: number;
  y?: number;
  deltaX?: number;
  deltaY?: number;
}

export interface KeyboardAction {
  type: 'type' | 'keyPress' | 'keyDown' | 'keyUp';
  text?: string;
  key?: string;
  modifiers?: string[];
}

export interface AppInfo {
  name: string;
  bundleId?: string;
  pid?: number;
  isFrontmost?: boolean;
}

export interface ComputerUseAdapter {
  readonly capabilities: ComputerUseCapabilities;

  isSupported(): boolean;

  takeScreenshot(options?: ScreenshotOptions): Promise<ScreenshotResult>;
  getDisplayGeometry(): Promise<{
    width: number;
    height: number;
    scaleFactor: number;
  }>;

  mouseAction(action: MouseAction): Promise<void>;
  getMousePosition(): Promise<MousePosition>;

  keyboardAction(action: KeyboardAction): Promise<void>;

  getClipboard(): Promise<string>;
  setClipboard(text: string): Promise<void>;

  getRunningApps(): Promise<AppInfo[]>;
  getFrontmostApp(): Promise<AppInfo | null>;
  launchApp(bundleIdOrPath: string): Promise<boolean>;
  activateApp(bundleId: string): Promise<boolean>;

  destroy(): Promise<void>;
}
