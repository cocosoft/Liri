/**
 * ComputerUse Linux 适配器
 *
 * 通过 Linux 标准桌面工具（xdotool、import、xclip、xrandr 等）
 * 实现截图、鼠标键盘控制、剪贴板访问和应用管理。
 * 不依赖任何第三方 npm 包，仅使用发行版自带或广泛可用的工具。
 *
 * 注意：
 * - 仅支持 X11 会话，Wayland 下 xdotool 无法正常工作
 * - 使用前请确保已安装：xdotool, xclip, imagemagick, wmctrl
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
  DisplayGeometry,
} from './types';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';

const execAsync = promisify(execFile);

/** 命令执行默认超时时间（毫秒） */
const CMD_TIMEOUT_DEFAULT = 15_000;

/** 截图类操作超时时间（毫秒） */
const CMD_TIMEOUT_SCREENSHOT = 30_000;

const LINUX_CAPABILITIES: ComputerUseCapabilities = {
  screenshot: true,
  mouseControl: true,
  keyboardControl: true,
  clipboardAccess: true,
  appManagement: true,
  platform: 'linux',
};

/** 鼠标按钮到 xdotool 按钮编号的映射 */
const BUTTON_MAP: Record<string, string> = {
  left: '1',
  middle: '2',
  right: '3',
};

/**
 * Linux 适配器实现
 * 使用 xdotool、import (ImageMagick)、xclip、xrandr、wmctrl 等标准工具
 */
export class LinuxComputerUseAdapter implements ComputerUseAdapter {
  readonly capabilities: ComputerUseCapabilities = LINUX_CAPABILITIES;

  isSupported(): boolean {
    return process.platform === 'linux';
  }

  /**
   * 检查是否在 X11 会话中运行
   * Wayland 下 xdotool 不可用
   */
  private isX11Session(): boolean {
    const sessionType = process.env.XDG_SESSION_TYPE || '';
    return sessionType.toLowerCase() !== 'wayland';
  }

  /**
   * 执行 shell 命令，返回 stdout 字符串
   */
  private async execCommand(
    command: string,
    args: string[],
    timeoutMs: number = CMD_TIMEOUT_DEFAULT
  ): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await execAsync(command, args, {
        signal: controller.signal,
        maxBuffer: 10 * 1024 * 1024,
      });
      return result.stdout ? result.stdout.toString() : '';
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(`命令执行超时: ${command} (${timeoutMs}ms)`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async takeScreenshot(options?: ScreenshotOptions): Promise<ScreenshotResult> {
    const quality = options?.quality ?? 0.75;
    const region = options?.region;
    const displayId = options?.displayId ?? 0;

    // 使用 ImageMagick 的 import 命令截图到 stdout（JPEG 格式）
    const tmpFile = `/tmp/liri_screenshot_${Date.now()}.jpg`;
    const qualityArg = Math.round(quality * 100);

    try {
      const args: string[] = [];

      // 窗口/区域 ID
      if (displayId > 0) {
        args.push('-display', `:0.${displayId}`);
      }

      if (region) {
        args.push('-crop', `${region.width}x${region.height}+${region.x}+${region.y}`);
      }

      // 设置质量并输出到临时文件
      args.push('-quality', String(qualityArg));
      args.push(tmpFile);

      await this.execCommand('import', args, CMD_TIMEOUT_SCREENSHOT);

      // 读取文件
      const data = fs.readFileSync(tmpFile);

      // 通过 identify 获取图片尺寸
      let width = 0;
      let height = 0;
      try {
        const dimInfo = await this.execCommand('identify', [
          '-format', '%w %h',
          tmpFile,
        ], 5_000);
        const parts = dimInfo.trim().split(' ').map(Number);
        if (parts.length === 2) {
          width = parts[0];
          height = parts[1];
        }
      } catch {
        // 尺寸获取失败时使用默认值
        width = 0;
        height = 0;
      }

      // 清理临时文件
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }

      return { data, format: 'jpeg', width, height };
    } catch (err) {
      // 清理临时文件
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      throw err;
    }
  }

  async getDisplayGeometry(): Promise<{
    width: number;
    height: number;
    scaleFactor: number;
  }> {
    try {
      // 使用 xrandr 获取主显示器信息
      const stdout = await this.execCommand('xrandr', ['--query']);
      const lines = stdout.split('\n');

      for (const line of lines) {
        // 匹配当前模式的显示行，如: "HDMI-1 connected primary 1920x1080+0+0"
        const primaryMatch = line.match(/primary\s+(\d+)x(\d+)/);
        if (primaryMatch) {
          return {
            width: parseInt(primaryMatch[1], 10),
            height: parseInt(primaryMatch[2], 10),
            scaleFactor: 1,
          };
        }
      }

      // 没有标注 primary，取第一个 connected 且带模式的显示器
      for (const line of lines) {
        const connMatch = line.match(/connected\s+(\d+)x(\d+)/);
        if (connMatch) {
          return {
            width: parseInt(connMatch[1], 10),
            height: parseInt(connMatch[2], 10),
            scaleFactor: 1,
          };
        }
      }

      return { width: 0, height: 0, scaleFactor: 1 };
    } catch {
      return { width: 0, height: 0, scaleFactor: 1 };
    }
  }

  async getAllDisplays(): Promise<DisplayGeometry[]> {
    try {
      const stdout = await this.execCommand('xrandr', ['--query']);
      const lines = stdout.split('\n');
      const displays: DisplayGeometry[] = [];
      let id = 0;

      for (const line of lines) {
        // 匹配显示器行，如: "HDMI-1 connected primary 1920x1080+0+0"
        const match = line.match(/^(\S+)\s+connected\s+(primary\s+)?(\d+)x(\d+)\+(-?\d+)\+(-?\d+)/);
        if (match) {
          const isPrimary = !!match[2];
          displays.push({
            id,
            width: parseInt(match[3], 10),
            height: parseInt(match[4], 10),
            x: parseInt(match[5], 10),
            y: parseInt(match[6], 10),
            isPrimary,
          });
          id++;
        }
      }

      return displays;
    } catch {
      return [];
    }
  }

  async mouseAction(action: MouseAction): Promise<void> {
    // 对于 click/doubleClick/rightClick 且带了坐标的，先移动鼠标
    if (
      (action.type === 'click' || action.type === 'doubleClick' || action.type === 'rightClick') &&
      action.x !== undefined && action.y !== undefined
    ) {
      await this.mouseAction({ type: 'move', x: action.x, y: action.y });
    }

    switch (action.type) {
      case 'move': {
        await this.execCommand('xdotool', [
          'mousemove',
          String(action.x),
          String(action.y),
        ]);
        break;
      }
      case 'click': {
        const btn = BUTTON_MAP[action.button ?? 'left'] || '1';
        await this.execCommand('xdotool', ['click', btn]);
        break;
      }
      case 'doubleClick': {
        await this.execCommand('xdotool', ['click', '--repeat', '2', '--delay', '50', '1']);
        break;
      }
      case 'rightClick': {
        await this.execCommand('xdotool', ['click', '3']);
        break;
      }
      case 'mouseDown': {
        const btn = BUTTON_MAP[action.button ?? 'left'] || '1';
        await this.execCommand('xdotool', ['mousedown', btn]);
        break;
      }
      case 'mouseUp': {
        const btn = BUTTON_MAP[action.button ?? 'left'] || '1';
        await this.execCommand('xdotool', ['mouseup', btn]);
        break;
      }
      case 'scroll': {
        const deltaY = action.deltaY ?? 0;
        const deltaX = action.deltaX ?? 0;

        // xdotool click 4=scroll up, 5=scroll down
        // 水平滚动使用 6=scroll left, 7=scroll right
        const absY = Math.abs(deltaY);
        const absX = Math.abs(deltaX);

        for (let i = 0; i < absY; i++) {
          const btn = deltaY < 0 ? '4' : '5';
          await this.execCommand('xdotool', ['click', btn]);
        }

        for (let i = 0; i < absX; i++) {
          const btn = deltaX < 0 ? '6' : '7';
          await this.execCommand('xdotool', ['click', btn]);
        }
        break;
      }
    }
  }

  async getMousePosition(): Promise<MousePosition> {
    const stdout = await this.execCommand('xdotool', ['getmouselocation']);
    // 输出格式: "x:1234 y:567 screen:0 window:234"
    const xMatch = stdout.match(/x:(\d+)/);
    const yMatch = stdout.match(/y:(\d+)/);

    return {
      x: xMatch ? parseInt(xMatch[1], 10) : 0,
      y: yMatch ? parseInt(yMatch[1], 10) : 0,
    };
  }

  async keyboardAction(action: KeyboardAction): Promise<void> {
    switch (action.type) {
      case 'type': {
        if (!action.text) break;
        // 使用 --delay 选项确保输入稳定
        await this.execCommand('xdotool', ['type', '--delay', '12', action.text]);
        break;
      }
      case 'keyPress': {
        if (!action.key) break;
        const mappedKey = this.mapKeyName(action.key);
        await this.execCommand('xdotool', ['key', mappedKey]);
        break;
      }
      case 'keyCombination': {
        if (!action.key) break;
        // xdotool 使用 "+" 连接组合键，如 "ctrl+c", "alt+Tab"
        const parts = action.key.toLowerCase().split('+');
        const mappedParts = parts.map((p) => this.mapKeyName(p));
        const combo = mappedParts.join('+');
        await this.execCommand('xdotool', ['key', combo]);
        break;
      }
      case 'keyDown': {
        if (!action.key) break;
        const mappedKey = this.mapKeyName(action.key);
        await this.execCommand('xdotool', ['keydown', mappedKey]);
        break;
      }
      case 'keyUp': {
        if (!action.key) break;
        const mappedKey = this.mapKeyName(action.key);
        await this.execCommand('xdotool', ['keyup', mappedKey]);
        break;
      }
      case 'keyHold': {
        if (!action.key) break;
        const ms = action.durationMs ?? 500;
        const mappedKey = this.mapKeyName(action.key);
        await this.execCommand('xdotool', ['keydown', mappedKey]);
        await this.sleep(ms);
        await this.execCommand('xdotool', ['keyup', mappedKey]);
        break;
      }
    }
  }

  /**
   * 将按键名映射为 xdotool 可识别的格式
   * xdotool 使用 X11 keysym 名称，不区分大小写
   */
  private mapKeyName(key: string): string {
    const keyMap: Record<string, string> = {
      enter: 'Return',
      return: 'Return',
      tab: 'Tab',
      space: 'space',
      backspace: 'BackSpace',
      delete: 'Delete',
      esc: 'Escape',
      escape: 'Escape',
      home: 'Home',
      end: 'End',
      up: 'Up',
      down: 'Down',
      left: 'Left',
      right: 'Right',
      pageup: 'Page_Up',
      pagedown: 'Page_Down',
      ctrl: 'Control_L',
      control: 'Control_L',
      alt: 'Alt_L',
      shift: 'Shift_L',
      cmd: 'Super_L',
      command: 'Super_L',
      win: 'Super_L',
      windows: 'Super_L',
      super: 'Super_L',
      caps: 'Caps_Lock',
      caps_lock: 'Caps_Lock',
      f1: 'F1',
      f2: 'F2',
      f3: 'F3',
      f4: 'F4',
      f5: 'F5',
      f6: 'F6',
      f7: 'F7',
      f8: 'F8',
      f9: 'F9',
      f10: 'F10',
      f11: 'F11',
      f12: 'F12',
      insert: 'Insert',
      print: 'Print',
      menu: 'Menu',
      pause: 'Pause',
    };

    const lower = key.toLowerCase();
    return keyMap[lower] || key;
  }

  async getClipboard(): Promise<string> {
    try {
      const stdout = await this.execCommand('xclip', [
        '-o', '-selection', 'clipboard',
      ]);
      return stdout;
    } catch {
      // 尝试退回到主选择区
      try {
        const stdout = await this.execCommand('xclip', [
          '-o', '-selection', 'primary',
        ]);
        return stdout;
      } catch {
        return '';
      }
    }
  }

  async setClipboard(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('xclip', ['-i', '-selection', 'clipboard'], {
        stdio: ['pipe', 'ignore', 'ignore'],
      });

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('xclip 执行超时'));
      }, CMD_TIMEOUT_DEFAULT);

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`xclip exited with code ${code}`));
        }
      });

      child.stdin!.write(text);
      child.stdin!.end();
    });
  }

  async getRunningApps(): Promise<AppInfo[]> {
    const apps: AppInfo[] = [];

    // 通过读取 /proc 和 wmctrl 获取正在运行的窗口应用
    try {
      // 使用 wmctrl 列出所有窗口
      const stdout = await this.execCommand('wmctrl', [
        '-l', '-p',
      ], 5_000);

      const lines = stdout.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        // 格式: "0x01234567  PID  DESKTOP  TITLE"
        const parts = line.split(/\s+/);
        if (parts.length >= 4) {
          const pid = parseInt(parts[1], 10);
          const windowId = parts[0];
          // 标题从第4部分开始（桌面号后）
          const title = parts.slice(3).join(' ');
          apps.push({
            name: title || 'Untitled',
            pid,
          });
        }
      }
    } catch {
      // wmctrl 不可用时尝试通过 xdotool
      try {
        const stdout = await this.execCommand('xdotool', [
          'search', '', '', // 获取所有窗口
        ], 5_000);
        const windowIds = stdout.trim().split('\n').filter(Boolean);

        for (const wid of windowIds.slice(0, 50)) {
          try {
            const name = await this.execCommand('xdotool', [
              'getwindowname', wid,
            ]);
            const pidStr = await this.execCommand('xdotool', [
              'getwindowpid', wid,
            ]);
            const nameClean = name.trim();
            if (nameClean) {
              apps.push({
                name: nameClean,
                pid: parseInt(pidStr.trim(), 10) || undefined,
              });
            }
          } catch {
            // 单个窗口查询失败跳过
          }
        }
      } catch {
        // 两种方式都失败
      }
    }

    return apps;
  }

  async getFrontmostApp(): Promise<AppInfo | null> {
    try {
      const windowId = await this.execCommand('xdotool', [
        'getactivewindow',
      ]);
      const wid = windowId.trim();

      let name = '';
      try {
        name = (await this.execCommand('xdotool', [
          'getwindowname', wid,
        ])).trim();
      } catch {
        name = 'unknown';
      }

      let pid: number | undefined;
      try {
        const pidStr = await this.execCommand('xdotool', [
          'getwindowpid', wid,
        ]);
        pid = parseInt(pidStr.trim(), 10);
      } catch {
        pid = undefined;
      }

      return { name: name || 'unknown', pid, isFrontmost: true };
    } catch {
      return null;
    }
  }

  async launchApp(bundleIdOrPath: string): Promise<boolean> {
    try {
      await this.execCommand('xdg-open', [bundleIdOrPath]);
      return true;
    } catch {
      // xdg-open 失败时尝试直接执行
      try {
        const child = spawn(bundleIdOrPath, [], {
          stdio: 'ignore',
          detached: true,
        });
        child.unref();
        return true;
      } catch {
        return false;
      }
    }
  }

  async activateApp(_bundleId: string): Promise<boolean> {
    // 通过窗口标题搜索并激活窗口
    try {
      const stdout = await this.execCommand('xdotool', [
        'search', '--name', _bundleId,
        '--limit', '1',
      ], 5_000);
      const wid = stdout.trim();
      if (wid) {
        await this.execCommand('xdotool', [
          'windowactivate', wid,
        ]);
        return true;
      }

      // 尝试按类名搜索
      const stdout2 = await this.execCommand('xdotool', [
        'search', '--class', _bundleId,
        '--limit', '1',
      ], 5_000);
      const wid2 = stdout2.trim();
      if (wid2) {
        await this.execCommand('xdotool', [
          'windowactivate', wid2,
        ]);
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  async destroy(): Promise<void> {
    // Linux 适配器无需清理资源
  }

  /**
   * 异步延时辅助方法
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
