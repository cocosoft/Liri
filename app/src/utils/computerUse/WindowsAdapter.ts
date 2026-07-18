/**
 * ComputerUse Windows 适配器
 *
 * 通过 PowerShell 脚本实现截图、鼠标键盘控制、
 * 剪贴板访问和应用管理。
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
import { execFile } from 'child_process';
import { promisify } from 'util';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'utils:computerUse:WindowsAdapter', level: LogLevel.INFO });

const execAsync = promisify(execFile);

/** PowerShell 脚本执行默认超时时间（毫秒） */
const PS_TIMEOUT_DEFAULT = 15_000;

/** 截图类操作超时时间（毫秒） */
const PS_TIMEOUT_SCREENSHOT = 30_000;

const WINDOWS_CAPABILITIES: ComputerUseCapabilities = {
  screenshot: true,
  mouseControl: true,
  keyboardControl: true,
  clipboardAccess: true,
  appManagement: true,
  platform: 'win32',
};

/**
 * Windows PowerShell 适配器实现
 * 使用 user32.dll + System.Windows.Forms + System.Drawing 进行桌面操作
 */
export class WindowsComputerUseAdapter implements ComputerUseAdapter {
  readonly capabilities: ComputerUseCapabilities = WINDOWS_CAPABILITIES;

  isSupported(): boolean {
    return process.platform === 'win32';
  }

  /**
   * 执行 PowerShell 脚本，带超时保护
   * @param script - PowerShell 脚本内容
   * @param timeoutMs - 超时时间（毫秒），默认 PS_TIMEOUT_DEFAULT
   */
  private async runPowerShell(
    script: string,
    timeoutMs: number = PS_TIMEOUT_DEFAULT
  ): Promise<{ stdout: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await execAsync(
        'powershell',
        ['-NoProfile', '-Command', script],
        { signal: controller.signal }
      );
      return { stdout: result.stdout ? result.stdout.toString() : '' };
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(`PowerShell 脚本执行超时 (${timeoutMs}ms)`);
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

    let script: string;
    if (region) {
      // 区域截图
      script = `
        Add-Type -AssemblyName System.Drawing
        Add-Type -AssemblyName System.Windows.Forms
        $bmp = New-Object System.Drawing.Bitmap(${region.width}, ${region.height})
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen(${region.x}, ${region.y}, 0, 0, New-Object System.Drawing.Size(${region.width}, ${region.height}))
        $g.Dispose()
        $ms = New-Object System.IO.MemoryStream
        $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
        $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long](${quality} * 100))
        $encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object {$_.FormatID -eq [System.Drawing.Imaging.ImageFormat]::Jpeg.Guid}
        $bmp.Save($ms, $encoder, $encoderParams)
        $bmp.Dispose()
        "$(${region.width}),$(${region.height})"
        [Convert]::ToBase64String($ms.ToArray())
      `;
    } else if (displayId === 0) {
      // 主显示器全屏截图
      script = `
        Add-Type -AssemblyName System.Drawing
        Add-Type -AssemblyName System.Windows.Forms
        $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bounds.Size)
        $g.Dispose()
        $ms = New-Object System.IO.MemoryStream
        $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
        $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long](${quality} * 100))
        $encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object {$_.FormatID -eq [System.Drawing.Imaging.ImageFormat]::Jpeg.Guid}
        $bmp.Save($ms, $encoder, $encoderParams)
        $bmp.Dispose()
        "$($bounds.Width),$($bounds.Height)"
        [Convert]::ToBase64String($ms.ToArray())
      `;
    } else {
      // 扩展显示器截图
      script = `
        Add-Type -AssemblyName System.Drawing
        Add-Type -AssemblyName System.Windows.Forms
        $screens = [System.Windows.Forms.Screen]::AllScreens
        if ($screens.Count -gt ${displayId}) {
          $bounds = $screens[${displayId}].Bounds
          $bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
          $g = [System.Drawing.Graphics]::FromImage($bmp)
          $g.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bounds.Size)
          $g.Dispose()
          $ms = New-Object System.IO.MemoryStream
          $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
          $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long](${quality} * 100))
          $encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object {$_.FormatID -eq [System.Drawing.Imaging.ImageFormat]::Jpeg.Guid}
          $bmp.Save($ms, $encoder, $encoderParams)
          $bmp.Dispose()
          "$($bounds.Width),$($bounds.Height)"
          [Convert]::ToBase64String($ms.ToArray())
        }
      `;
    }

    const { stdout } = await this.runPowerShell(script, PS_TIMEOUT_SCREENSHOT);

    const output = stdout.trim();
    const lines = output
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    // 第一行是 "width,height"，后面的 base64 数据可能跨多行
    const dimLine = lines.find((l) => /^\d+,\d+$/.test(l));
    let width = 0;
    let height = 0;
    if (dimLine) {
      const parts = dimLine.split(',').map(Number);
      width = parts[0];
      height = parts[1];
    }

    // 拼接所有非尺寸行的内容作为 base64 数据
    const base64Lines = lines.filter((l) => !/^\d+,\d+$/.test(l));
    const data = Buffer.from(base64Lines.join(''), 'base64');
    return { data, format: 'jpeg', width, height };
  }

  async getDisplayGeometry(): Promise<{
    width: number;
    height: number;
    scaleFactor: number;
  }> {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
      "$($bounds.Width),$($bounds.Height),1"
    `;
    const { stdout } = await this.runPowerShell(script);
    const [w, h, s] = stdout.trim().split(',').map(Number);
    return { width: w, height: h, scaleFactor: s || 1 };
  }

  /**
   * 获取所有显示器的几何信息
   */
  async getAllDisplays(): Promise<DisplayGeometry[]> {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      $screens = [System.Windows.Forms.Screen]::AllScreens
      $result = @()
      for ($i = 0; $i -lt $screens.Count; $i++) {
        $s = $screens[$i]
        $result += @{
          id=$i
          width=$s.Bounds.Width
          height=$s.Bounds.Height
          x=$s.Bounds.X
          y=$s.Bounds.Y
          isPrimary=$s.Primary
        }
      }
      $result | ConvertTo-Json -Compress
    `;
    const { stdout } = await this.runPowerShell(script);
    try {
      const displays: Array<{
        id: number;
        width: number;
        height: number;
        x: number;
        y: number;
        isPrimary: boolean;
      }> = JSON.parse(stdout.trim());
      return (Array.isArray(displays) ? displays : [displays]).map((d) => ({
        id: d.id,
        width: d.width,
        height: d.height,
        x: d.x,
        y: d.y,
        isPrimary: d.isPrimary,
      }));
    } catch {
      return [];
    }
  }

  async mouseAction(action: MouseAction): Promise<void> {
    // 如果是 click/doubleClick 且带了 x/y，先移动鼠标
    if (
      (action.type === 'click' || action.type === 'doubleClick') &&
      action.x !== undefined &&
      action.y !== undefined
    ) {
      await this.mouseAction({ type: 'move', x: action.x, y: action.y });
    }
    const script = this.buildMouseScript(action);
    await this.runPowerShell(script);
  }

  async getMousePosition(): Promise<MousePosition> {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      $pos = [System.Windows.Forms.Cursor]::Position
      "$($pos.X),$($pos.Y)"
    `;
    const { stdout } = await this.runPowerShell(script);
    const [x, y] = stdout.trim().split(',').map(Number);
    return { x, y };
  }

  async keyboardAction(action: KeyboardAction): Promise<void> {
    const script = this.buildKeyboardScript(action);
    await this.runPowerShell(script);
  }

  async getClipboard(): Promise<string> {
    const script = 'Get-Clipboard -Raw';
    const { stdout } = await this.runPowerShell(script);
    return stdout;
  }

  async setClipboard(text: string): Promise<void> {
    const encoded = Buffer.from(text, 'utf-8').toString('base64');
    const script = `[System.Windows.Forms.Clipboard]::SetText([System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')))`;
    await this.runPowerShell(
      `Add-Type -AssemblyName System.Windows.Forms; ${script}`
    );
  }

  async getRunningApps(): Promise<AppInfo[]> {
    const script = `
      Get-Process | Where-Object {$_.MainWindowTitle} |
      Select-Object -First 50 Name,Id,MainWindowTitle |
      ConvertTo-Json -Compress
    `;
    const { stdout } = await this.runPowerShell(script);
    try {
      const processes: Array<{
        Name: string;
        Id: number;
        MainWindowTitle: string;
      }> = JSON.parse(stdout);
      return (Array.isArray(processes) ? processes : [processes]).map((p) => ({
        name: p.MainWindowTitle || p.Name,
        pid: p.Id,
      }));
    } catch {
      return [];
    }
  }

  async getFrontmostApp(): Promise<AppInfo | null> {
    const script = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        using System.Text;
        public class Win32 {
          [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
          [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
          [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
        }
"@
      $hwnd = [Win32]::GetForegroundWindow()
      $sb = New-Object System.Text.StringBuilder(256)
      [Win32]::GetWindowText($hwnd, $sb, 256) | Out-Null
      $pid = 0
      [Win32]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
      "$($sb.ToString()),$pid"
    `;
    const { stdout } = await this.runPowerShell(script);
    const [name, pidStr] = stdout.trim().split(',');
    return { name, pid: parseInt(pidStr) };
  }

  async launchApp(bundleIdOrPath: string): Promise<boolean> {
    try {
      await this.runPowerShell(`Start-Process '${bundleIdOrPath}'`);
      return true;
    } catch {
      return false;
    }
  }

  async activateApp(_bundleId: string): Promise<boolean> {
    // 通过窗口标题或进程名激活窗口
    try {
      const script = `
        Add-Type @"
          using System;
          using System.Runtime.InteropServices;
          public class Win32 {
            [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
            [DllImport("user32.dll")] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
            [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
          }
"@
        $hwnd = [Win32]::FindWindow([nullstring]::value, '${_bundleId}')
        if ($hwnd -ne [IntPtr]::Zero) {
          [Win32]::ShowWindow($hwnd, 9)  # SW_RESTORE
          [Win32]::SetForegroundWindow($hwnd) | Out-Null
          $true
        } else {
          $false
        }
      `;
      const { stdout } = await this.runPowerShell(script);
      return stdout.trim() === 'True';
    } catch {
      return false;
    }
  }

  async destroy(): Promise<void> {}

  /**
   * 构建鼠标操作的 PowerShell 脚本
   */
  private buildMouseScript(action: MouseAction): string {
    let buttonCode: string;
    if (action.button === 'right') {
      buttonCode = '0x0008'; // MOUSEEVENTF_RIGHTDOWN
    } else if (action.button === 'middle') {
      buttonCode = '0x0020'; // MOUSEEVENTF_MIDDLEDOWN
    } else {
      buttonCode = '0x0002'; // MOUSEEVENTF_LEFTDOWN (default)
    }
    // button up code
    const buttonUpCode =
      buttonCode === '0x0008'
        ? '0x0010'
        : buttonCode === '0x0020'
          ? '0x0040'
          : '0x0004';

    switch (action.type) {
      case 'move':
        return `
          Add-Type -AssemblyName System.Windows.Forms
          [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${action.x}, ${action.y})
        `;
      case 'click':
        return `
          Add-Type -AssemblyName System.Windows.Forms
          Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);' -Name Mouse -Namespace Win32
          [Win32.Mouse]::mouse_event(${buttonCode}, 0, 0, 0, 0)
          Start-Sleep -Milliseconds 50
          [Win32.Mouse]::mouse_event(${buttonUpCode}, 0, 0, 0, 0)
        `;
      case 'doubleClick':
        return `
          Add-Type -AssemblyName System.Windows.Forms
          Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);' -Name Mouse -Namespace Win32
          [Win32.Mouse]::mouse_event(${buttonCode}, 0, 0, 0, 0)
          Start-Sleep -Milliseconds 50
          [Win32.Mouse]::mouse_event(${buttonUpCode}, 0, 0, 0, 0)
          Start-Sleep -Milliseconds 50
          [Win32.Mouse]::mouse_event(${buttonCode}, 0, 0, 0, 0)
          Start-Sleep -Milliseconds 50
          [Win32.Mouse]::mouse_event(${buttonUpCode}, 0, 0, 0, 0)
        `;
      case 'rightClick':
        return `
          Add-Type -AssemblyName System.Windows.Forms
          Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);' -Name Mouse -Namespace Win32
          [Win32.Mouse]::mouse_event(0x0008, 0, 0, 0, 0)
          Start-Sleep -Milliseconds 50
          [Win32.Mouse]::mouse_event(0x0010, 0, 0, 0, 0)
        `;
      case 'mouseDown':
        return `
          Add-Type -AssemblyName System.Windows.Forms
          Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);' -Name Mouse -Namespace Win32
          [Win32.Mouse]::mouse_event(${buttonCode}, 0, 0, 0, 0)
        `;
      case 'mouseUp':
        return `
          Add-Type -AssemblyName System.Windows.Forms
          Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);' -Name Mouse -Namespace Win32
          [Win32.Mouse]::mouse_event(${buttonUpCode}, 0, 0, 0, 0)
        `;
      case 'scroll':
        return `
          Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);' -Name Mouse -Namespace Win32
          [Win32.Mouse]::mouse_event(0x0800, 0, 0, ${action.deltaY ? -action.deltaY * 120 : 0}, 0)
        `;
      default:
        return '';
    }
  }

  /**
   * 构建键盘操作的 PowerShell 脚本
   *
   * 按键名到 SendKeys 格式的映射
   * SendKeys 特殊编码:
   *   ^ = Ctrl
   *   + = Shift
   *   % = Alt
   */
  private buildKeyboardScript(action: KeyboardAction): string {
    switch (action.type) {
      case 'type':
        if (action.text) {
          const encoded = Buffer.from(action.text, 'utf-8').toString('base64');
          return `
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.SendKeys]::SendWait([System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')))
          `;
        }
        return '';
      case 'keyPress':
        if (action.key) {
          return `
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.SendKeys]::SendWait('{${action.key.toUpperCase()}}')
          `;
        }
        return '';
      case 'keyCombination': {
        // 支持组合键语法如 "ctrl+c", "alt+tab", "ctrl+shift+esc"
        if (!action.key) return '';
        const parts = action.key.toLowerCase().split('+');
        const modifiers = parts.slice(0, -1);
        const mainKey = parts[parts.length - 1];

        // 将修饰键映射为 SendKeys 前缀
        let prefix = '';
        for (const mod of modifiers) {
          switch (mod) {
            case 'ctrl':
            case 'control':
              prefix += '^';
              break;
            case 'alt':
              prefix += '%';
              break;
            case 'shift':
              prefix += '+';
              break;
            case 'win':
            case 'windows':
            case 'meta':
              prefix += '^'; // 退化为 Ctrl（Windows 兼容）
              break;
          }
        }

        // 特殊键映射（功能键、方向键等）
        const keyMap: Record<string, string> = {
          enter: '{ENTER}',
          tab: '{TAB}',
          esc: '{ESC}',
          escape: '{ESC}',
          backspace: '{BACKSPACE}',
          delete: '{DELETE}',
          home: '{HOME}',
          end: '{END}',
          up: '{UP}',
          down: '{DOWN}',
          left: '{LEFT}',
          right: '{RIGHT}',
          pageup: '{PGUP}',
          pagedown: '{PGDN}',
          space: ' ',
          f1: '{F1}',
          f2: '{F2}',
          f3: '{F3}',
          f4: '{F4}',
          f5: '{F5}',
          f6: '{F6}',
          f7: '{F7}',
          f8: '{F8}',
          f9: '{F9}',
          f10: '{F10}',
          f11: '{F11}',
          f12: '{F12}',
        };

        const mappedKey = keyMap[mainKey] || mainKey.toUpperCase();

        return `
          Add-Type -AssemblyName System.Windows.Forms
          [System.Windows.Forms.SendKeys]::SendWait('${prefix}${mappedKey}')
        `;
      }
      case 'keyDown':
        if (action.key) {
          return `
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.SendKeys]::SendWait('{${action.key.toUpperCase()} down}')
          `;
        }
        return '';
      case 'keyUp':
        if (action.key) {
          return `
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.SendKeys]::SendWait('{${action.key.toUpperCase()} up}')
          `;
        }
        return '';
      case 'keyHold':
        if (action.key) {
          const ms = action.durationMs ?? 500;
          return `
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.SendKeys]::SendWait('{${action.key.toUpperCase()} down}')
            Start-Sleep -Milliseconds ${ms}
            [System.Windows.Forms.SendKeys]::SendWait('{${action.key.toUpperCase()} up}')
          `;
        }
        return '';
      default:
        return '';
    }
  }
}
