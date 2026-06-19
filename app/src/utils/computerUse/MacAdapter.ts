/**
 * ComputerUse macOS 适配器
 *
 * 通过 macOS 原生命令（screencapture、osascript、pbpaste/pbcopy）
 * 实现截图、鼠标键盘控制、剪贴板访问和应用管理。
 * 不依赖任何第三方库，仅使用系统内置工具。
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

const execAsync = promisify(execFile);

/** osascript 执行默认超时时间（毫秒） */
const OSASCRIPT_TIMEOUT_DEFAULT = 15_000;

/** 截图类操作超时时间（毫秒） */
const OSASCRIPT_TIMEOUT_SCREENSHOT = 30_000;

/** JXA 截图脚本模板 */
const JXA_SCREENSHOT_SCRIPT = `
ObjC.import('CoreGraphics');
ObjC.import('AppKit');

function captureScreen(displayId, region, quality) {
  var mainID = $.CGMainDisplayID();
  var displayIDs = [];

  // 获取所有显示器 ID
  var maxDisplays = 8;
  var onlineDisplays = Ref();
  var displayCount = Ref();
  $.CGGetOnlineDisplayList(maxDisplays, onlineDisplays, displayCount);
  var onlineList = onlineDisplays[0];
  var count = displayCount[0];

  for (var i = 0; i < count; i++) {
    var n = onlineList[i];
    if (Number(n) !== 0) displayIDs.push(Number(n));
  }

  // 如果显示器索引大于 0，使用列表中的第 displayId 个
  var targetID = displayIDs[displayId] || mainID;
  if (displayId === 0 || !targetID) targetID = mainID;

  var bounds = $.CGDisplayBounds(targetID);
  var captureRect;

  if (region) {
    captureRect = $.CGRectMake(
      region.x, region.y,
      region.width, region.height
    );
  } else {
    captureRect = bounds;
  }

  var image = $.CGWindowListCreateImage(
    captureRect,
    $.kCGWindowListOptionOnScreenOnly,
    $.kCGNullWindowID,
    $.kCGWindowImageDefault
  );

  if (Number(image) === 0) {
    return JSON.stringify({ error: '截图失败' });
  }

  // 获取实际尺寸
  var imgWidth = Number($.CGImageGetWidth(image));
  var imgHeight = Number($.CGImageGetHeight(image));

  // 保存为 JPEG
  var bitmapRep = $.NSBitmapImageRep.alloc.initWithCGImage(image);
  var props = $.NSDictionary.dictionaryWithObjectForKey(
    $.NSNumber.numberWithFloat(quality || 0.75),
    $.NSImageCompressionFactor
  );
  var jpegData = bitmapRep.representationUsingTypeProperties(
    $.NSJPEGFileType,
    props
  );
  var base64Str = $.NSString.alloc.initWithDataEncoding(
    jpegData,
    $.NSUTF8StringEncoding
  );

  return JSON.stringify({
    width: imgWidth,
    height: imgHeight,
    base64: ObjC.unwrap(base64Str)
  });
}
`;

const MAC_CAPABILITIES: ComputerUseCapabilities = {
  screenshot: true,
  mouseControl: true,
  keyboardControl: true,
  clipboardAccess: true,
  appManagement: true,
  platform: 'darwin',
};

/**
 * macOS 适配器实现
 * 使用 screencapture、osascript（AppleScript/JXA）、pbpaste/pbcopy 等系统内置工具
 */
export class MacComputerUseAdapter implements ComputerUseAdapter {
  readonly capabilities: ComputerUseCapabilities = MAC_CAPABILITIES;

  isSupported(): boolean {
    return process.platform === 'darwin';
  }

  /**
   * 执行 osascript 命令，带超时保护
   * @param script - AppleScript 或 JXA 脚本内容
   * @param timeoutMs - 超时时间（毫秒）
   * @param language - 脚本语言，默认为 AppleScript
   */
  private async runOsascript(
    script: string,
    timeoutMs: number = OSASCRIPT_TIMEOUT_DEFAULT,
    language: 'AppleScript' | 'JavaScript' = 'AppleScript'
  ): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await execAsync(
        'osascript',
        language === 'JavaScript'
          ? ['-l', 'JavaScript', '-e', script]
          : ['-e', script],
        { signal: controller.signal, maxBuffer: 10 * 1024 * 1024 }
      );
      return result.stdout ? result.stdout.toString() : '';
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(`osascript 执行超时 (${timeoutMs}ms)`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 执行 shell 命令，返回 stdout 字符串
   */
  private async execShell(
    command: string,
    args: string[],
    timeoutMs: number = OSASCRIPT_TIMEOUT_DEFAULT
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

    // 使用 JXA 通过 CoreGraphics 截图，支持多显示器和区域
    const captureArgs = JSON.stringify({
      displayId,
      region: region || null,
      quality,
    });

    const script = `
      ${JXA_SCREENSHOT_SCRIPT}
      JSON.parse(captureScreen(${captureArgs}))
    `;

    const stdout = await this.runOsascript(
      script,
      OSASCRIPT_TIMEOUT_SCREENSHOT,
      'JavaScript'
    );

    try {
      const result = JSON.parse(stdout.trim());
      if (result.error) {
        // JXA 截图失败，回退到 screencapture 命令
        return this.takeScreenshotFallback(options);
      }

      const data = Buffer.from(result.base64, 'base64');
      return {
        data,
        format: 'jpeg',
        width: result.width,
        height: result.height,
      };
    } catch {
      // 解析失败，回退到 screencapture
      return this.takeScreenshotFallback(options);
    }
  }

  /**
   * 截图回退方案：使用 screencapture 命令
   */
  private async takeScreenshotFallback(
    options?: ScreenshotOptions
  ): Promise<ScreenshotResult> {
    const region = options?.region;
    const displayId = options?.displayId ?? 0;

    const args: string[] = ['-t', 'jpg', '-x'];

    // 区域截图
    if (region) {
      args.push(
        '-R',
        `${region.x},${region.y},${region.width},${region.height}`
      );
    } else if (displayId > 0) {
      // 指定显示器（screencapture -D 从 1 开始计数）
      args.push('-D', String(displayId + 1));
    }

    // 输出到 stdout
    args.push('-');

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      OSASCRIPT_TIMEOUT_SCREENSHOT
    );

    try {
      const result = await execAsync('screencapture', args, {
        signal: controller.signal,
        maxBuffer: 50 * 1024 * 1024,
      });
      const data = result.stdout
        ? Buffer.from(result.stdout.toString(), 'binary')
        : Buffer.alloc(0);

      // 通过 sips 获取图片尺寸
      let width = 0;
      let height = 0;
      try {
        const sipsResult = await new Promise<string>((resolve, reject) => {
          const child = spawn('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', '--stdin'], {
            stdio: ['pipe', 'pipe', 'ignore'],
          });

          const timer = setTimeout(() => {
            child.kill();
            reject(new Error('sips 执行超时'));
          }, 10_000);

          let stdout = '';
          child.stdout!.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
          });

          child.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
          });

          child.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) {
              resolve(stdout);
            } else {
              reject(new Error(`sips exited with code ${code}`));
            }
          });

          child.stdin!.end(data);
        });

        const wMatch = sipsResult.match(/pixelWidth: (\d+)/);
        const hMatch = sipsResult.match(/pixelHeight: (\d+)/);
        if (wMatch) width = parseInt(wMatch[1], 10);
        if (hMatch) height = parseInt(hMatch[1], 10);
      } catch {
        // 尺寸获取失败时使用默认值
        width = 0;
        height = 0;
      }

      return { data, format: 'jpeg', width, height };
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') {
        throw new Error('screencapture 截图超时');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async getDisplayGeometry(): Promise<{
    width: number;
    height: number;
    scaleFactor: number;
  }> {
    const script = `
      ObjC.import('CoreGraphics');
      var mainID = $.CGMainDisplayID();
      var bounds = $.CGDisplayBounds(mainID);
      var width = Math.round(Number(bounds.size.width));
      var height = Math.round(Number(bounds.size.height));
      var scale = Number($.CGDisplayPixelsWide(mainID)) / width;
      JSON.stringify({ width: width, height: height, scaleFactor: scale });
    `;

    const stdout = await this.runOsascript(script, OSASCRIPT_TIMEOUT_DEFAULT, 'JavaScript');
    try {
      return JSON.parse(stdout.trim());
    } catch {
      return { width: 0, height: 0, scaleFactor: 1 };
    }
  }

  async getAllDisplays(): Promise<DisplayGeometry[]> {
    const script = `
      ObjC.import('CoreGraphics');
      var mainID = $.CGMainDisplayID();
      var maxDisplays = 8;
      var onlineDisplays = Ref();
      var displayCount = Ref();
      $.CGGetOnlineDisplayList(maxDisplays, onlineDisplays, displayCount);
      var list = onlineDisplays[0];
      var count = displayCount[0];
      var result = [];
      for (var i = 0; i < count; i++) {
        var displayID = Number(list[i]);
        if (displayID === 0) continue;
        var bounds = $.CGDisplayBounds(displayID);
        result.push({
          id: i,
          width: Math.round(Number(bounds.size.width)),
          height: Math.round(Number(bounds.size.height)),
          x: Math.round(Number(bounds.origin.x)),
          y: Math.round(Number(bounds.origin.y)),
          isPrimary: displayID === Number(mainID)
        });
      }
      JSON.stringify(result);
    `;

    const stdout = await this.runOsascript(script, OSASCRIPT_TIMEOUT_DEFAULT, 'JavaScript');
    try {
      const displays: DisplayGeometry[] = JSON.parse(stdout.trim());
      return Array.isArray(displays) ? displays : [];
    } catch {
      return [];
    }
  }

  async mouseAction(action: MouseAction): Promise<void> {
    // 对于 click/doubleClick 且带了坐标的，先移动鼠标
    if (
      (action.type === 'click' || action.type === 'doubleClick' || action.type === 'rightClick') &&
      action.x !== undefined && action.y !== undefined
    ) {
      await this.mouseAction({ type: 'move', x: action.x, y: action.y });
    }

    switch (action.type) {
      case 'move': {
        const script = `
          tell application "System Events"
            set position of mouse to {${action.x}, ${action.y}}
          end tell
        `;
        await this.runOsascript(script);
        break;
      }
      case 'click': {
        const script = `
          tell application "System Events"
            click at {${action.x ?? 'current position'}, ${action.y ?? 'current position'}}
          end tell
        `;
        await this.runOsascript(script);
        break;
      }
      case 'doubleClick': {
        const script = `
          tell application "System Events"
            click at {${action.x ?? 'current position'}, ${action.y ?? 'current position'}}
            delay 0.05
            click at {${action.x ?? 'current position'}, ${action.y ?? 'current position'}}
          end tell
        `;
        await this.runOsascript(script);
        break;
      }
      case 'rightClick': {
        const script = `
          tell application "System Events"
            key code 124 using {control down}
            delay 0.05
            key code 126 using {control down}
          end tell
        `;
        // macOS System Events 的 click 不支持 button 参数，
        // 使用 Control+Click 模拟右键
        const rightClickScript = `
          tell application "System Events"
            set mousePosition to {${action.x ?? 'item 1 of (get position of mouse)'}, ${action.y ?? 'item 2 of (get position of mouse)'}}
            do shell script "osascript -e 'tell application \\"System Events\\" to click at " & mousePosition & " using {control down}'"
          end tell
        `;
        await this.runOsascript(rightClickScript);
        break;
      }
      case 'scroll': {
        const deltaY = action.deltaY ?? 0;
        const deltaX = action.deltaX ?? 0;
        // macOS 使用 CGEvent 进行滚动，通过 JXA 实现
        const scrollScript = `
          ObjC.import('CoreGraphics');
          var scrollEvent = $.CGEventCreateScrollWheelEvent(
            null,
            $.kCGScrollEventUnitLine,
            2,
            ${-deltaY},
            ${-deltaX}
          );
          $.CGEventPost($.kCGHIDEventTap, scrollEvent);
        `;
        await this.runOsascript(scrollScript, OSASCRIPT_TIMEOUT_DEFAULT, 'JavaScript');
        break;
      }
      case 'mouseDown': {
        const button = action.button === 'right' ? '2' : action.button === 'middle' ? '3' : '1';
        const script = `
          tell application "System Events"
            click at {${action.x ?? 'current position'}, ${action.y ?? 'current position'}}
          end tell
        `;
        await this.runOsascript(script);
        break;
      }
      case 'mouseUp': {
        // macOS System Events 没有直接的 mouseUp，
        // click 操作已经包含了按下和释放
        break;
      }
    }
  }

  async getMousePosition(): Promise<MousePosition> {
    const script = `
      tell application "System Events"
        set pos to position of mouse
        return (item 1 of pos) & "," & (item 2 of pos)
      end tell
    `;
    const stdout = await this.runOsascript(script);
    const [x, y] = stdout.trim().split(',').map(Number);
    return { x, y };
  }

  async keyboardAction(action: KeyboardAction): Promise<void> {
    switch (action.type) {
      case 'type': {
        if (!action.text) break;
        // 使用 base64 编码避免特殊字符在 AppleScript 中转义问题
        const encoded = Buffer.from(action.text, 'utf-8').toString('base64');
        const script = `
          set theText to do shell script "echo " & quoted form of "${encoded}" & " | base64 -d"
          tell application "System Events"
            keystroke theText
          end tell
        `;
        await this.runOsascript(script);
        break;
      }
      case 'keyPress': {
        if (!action.key) break;
        const keyCode = this.mapKeyToCode(action.key);
        if (keyCode !== null) {
          const script = `
            tell application "System Events"
              key code ${keyCode}
            end tell
          `;
          await this.runOsascript(script);
        } else {
          // 没有对应 key code 时，尝试直接 keystroke
          const script = `
            tell application "System Events"
              keystroke "${action.key}"
            end tell
          `;
          await this.runOsascript(script);
        }
        break;
      }
      case 'keyCombination': {
        if (!action.key) break;
        const parts = action.key.toLowerCase().split('+');
        const mainKey = parts[parts.length - 1];
        const modifiers = parts.slice(0, -1);

        // 构建 AppleScript 修饰语
        const usingClause = this.buildModifierClause(modifiers);

        // 主要按键处理
        const keyCode = this.mapKeyToCode(mainKey);
        if (keyCode !== null) {
          const script = `
            tell application "System Events"
              key code ${keyCode} ${usingClause}
            end tell
          `;
          await this.runOsascript(script);
        } else {
          // 对于字母数字键，使用 keystroke + modifiers
          const charKey = mainKey.length === 1 ? mainKey : '';
          if (charKey) {
            const script = `
              tell application "System Events"
                keystroke "${charKey}" ${usingClause}
              end tell
            `;
            await this.runOsascript(script);
          }
        }
        break;
      }
      case 'keyDown': {
        if (!action.key) break;
        const keyCode = this.mapKeyToCode(action.key);
        if (keyCode !== null) {
          const script = `
            tell application "System Events"
              key down ${keyCode}
            end tell
          `;
          await this.runOsascript(script);
        }
        break;
      }
      case 'keyUp': {
        if (!action.key) break;
        const keyCode = this.mapKeyToCode(action.key);
        if (keyCode !== null) {
          const script = `
            tell application "System Events"
              key up ${keyCode}
            end tell
          `;
          await this.runOsascript(script);
        }
        break;
      }
      case 'keyHold': {
        if (!action.key) break;
        const ms = action.durationMs ?? 500;
        const keyCode = this.mapKeyToCode(action.key);
        if (keyCode !== null) {
          const script = `
            tell application "System Events"
              key down ${keyCode}
              delay ${ms / 1000}
              key up ${keyCode}
            end tell
          `;
          await this.runOsascript(script);
        }
        break;
      }
    }
  }

  /**
   * 构建 AppleScript 修饰语子句
   * @param modifiers - 修饰键列表，如 ['command', 'shift']
   * @returns AppleScript 修饰语子句，如 "using {command down, shift down}"
   */
  private buildModifierClause(modifiers: string[]): string {
    if (modifiers.length === 0) return '';

    const modifierMap: Record<string, string> = {
      ctrl: 'control down',
      control: 'control down',
      cmd: 'command down',
      command: 'command down',
      alt: 'option down',
      option: 'option down',
      shift: 'shift down',
      win: 'command down',
      windows: 'command down',
      meta: 'command down',
    };

    const parts = modifiers
      .map((m) => modifierMap[m])
      .filter(Boolean);

    if (parts.length === 0) return '';
    return `using {${parts.join(', ')}}`;
  }

  /**
   * 将按键名映射为 macOS key code
   * @param key - 按键名（小写）
   * @returns key code，如果无法映射则返回 null
   */
  private mapKeyToCode(key: string): number | null {
    const keyCodeMap: Record<string, number> = {
      return: 36,
      enter: 36,
      tab: 48,
      space: 49,
      delete: 51,
      backspace: 51,
      escape: 53,
      esc: 53,
      command: 55,
      shift: 56,
      caps: 57,
      caps_lock: 57,
      option: 58,
      alt: 58,
      control: 59,
      ctrl: 59,
      right_shift: 60,
      right_shift2: 60,
      right_option: 61,
      right_alt: 61,
      right_control: 62,
      fn: 63,
      f1: 122,
      f2: 120,
      f3: 99,
      f4: 118,
      f5: 96,
      f6: 97,
      f7: 98,
      f8: 100,
      f9: 101,
      f10: 109,
      f11: 103,
      f12: 111,
      f13: 105,
      f14: 107,
      f15: 113,
      home: 115,
      end: 119,
      pageup: 116,
      pagedown: 121,
      up: 126,
      down: 125,
      left: 123,
      right: 124,
      forward_delete: 117,
      help: 114,
      mute: 74,
      volume_up: 73,
      volume_down: 72,
    };

    return keyCodeMap[key.toLowerCase()] ?? null;
  }

  async getClipboard(): Promise<string> {
    try {
      const stdout = await this.execShell('pbpaste', []);
      return stdout;
    } catch {
      return '';
    }
  }

  async setClipboard(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('pbcopy', [], {
        stdio: ['pipe', 'ignore', 'ignore'],
      });

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('pbcopy 执行超时'));
      }, OSASCRIPT_TIMEOUT_DEFAULT);

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`pbcopy exited with code ${code}`));
        }
      });

      child.stdin!.write(text);
      child.stdin!.end();
    });
  }

  async getRunningApps(): Promise<AppInfo[]> {
    const script = `
      tell application "System Events"
        set appList to every process whose background only is false
        set output to ""
        repeat with appProc in appList
          set appName to name of appProc
          set appPID to unix id of appProc
          set isFront to frontmost of appProc
          set output to output & appName & "|" & appPID & "|" & isFront & linefeed
        end repeat
        return output
      end tell
    `;

    const stdout = await this.runOsascript(script);
    const lines = stdout.trim().split('\n').filter(Boolean);

    return lines.map((line) => {
      const parts = line.split('|');
      return {
        name: parts[0] || '',
        pid: parseInt(parts[1], 10) || 0,
        isFrontmost: parts[2] === 'true',
      };
    });
  }

  async getFrontmostApp(): Promise<AppInfo | null> {
    const script = `
      tell application "System Events"
        set frontProc to first process whose frontmost is true
        return (name of frontProc) & "|" & (unix id of frontProc)
      end tell
    `;

    try {
      const stdout = await this.runOsascript(script);
      const [name, pidStr] = stdout.trim().split('|');
      return {
        name: name || 'unknown',
        pid: parseInt(pidStr, 10) || 0,
        isFrontmost: true,
      };
    } catch {
      return null;
    }
  }

  async launchApp(bundleIdOrPath: string): Promise<boolean> {
    try {
      // 先尝试用 open 命令启动
      if (bundleIdOrPath.includes('.app') || bundleIdOrPath.includes('/')) {
        await this.execShell('open', ['-a', bundleIdOrPath]);
      } else {
        // 按 bundle identifier 启动
        await this.execShell('open', ['-b', bundleIdOrPath]);
      }
      return true;
    } catch {
      return false;
    }
  }

  async activateApp(bundleId: string): Promise<boolean> {
    try {
      const script = `
        tell application "${bundleId}"
          activate
        end tell
      `;
      await this.runOsascript(script);
      return true;
    } catch {
      // 尝试通过 bundle identifier 激活
      try {
        const scriptById = `
          tell application id "${bundleId}"
            activate
          end tell
        `;
        await this.runOsascript(scriptById);
        return true;
      } catch {
        return false;
      }
    }
  }

  async destroy(): Promise<void> {
    // macOS 适配器无需清理资源
  }
}
