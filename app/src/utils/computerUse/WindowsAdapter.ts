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
} from './types';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(execFile);

const WINDOWS_CAPABILITIES: ComputerUseCapabilities = {
  screenshot: true,
  mouseControl: true,
  keyboardControl: true,
  clipboardAccess: true,
  appManagement: true,
  platform: 'win32',
};

export class WindowsComputerUseAdapter implements ComputerUseAdapter {
  readonly capabilities: ComputerUseCapabilities = WINDOWS_CAPABILITIES;

  isSupported(): boolean {
    return process.platform === 'win32';
  }

  async takeScreenshot(options?: ScreenshotOptions): Promise<ScreenshotResult> {
    const quality = options?.quality ?? 0.75;
    const script = `
      Add-Type -AssemblyName System.Drawing
      Add-Type -AssemblyName System.Windows.Forms
      $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
      $bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.CopyFromScreen(0, 0, 0, 0, $bounds.Size)
      $g.Dispose()
      $ms = New-Object System.IO.MemoryStream
      $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
      $bmp.Dispose()
      [Convert]::ToBase64String($ms.ToArray())
    `;
    const { stdout } = await execAsync(
      'powershell',
      ['-NoProfile', '-Command', script],
      { encoding: 'buffer' }
    );
    const data = Buffer.from(stdout.toString().trim(), 'base64');
    return { data, format: 'jpeg', width: 0, height: 0 };
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
    const { stdout } = await execAsync('powershell', [
      '-NoProfile',
      '-Command',
      script,
    ]);
    const [w, h, s] = stdout.trim().split(',').map(Number);
    return { width: w, height: h, scaleFactor: s || 1 };
  }

  async mouseAction(action: MouseAction): Promise<void> {
    const script = this.buildMouseScript(action);
    await execAsync('powershell', ['-NoProfile', '-Command', script]);
  }

  async getMousePosition(): Promise<MousePosition> {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      $pos = [System.Windows.Forms.Cursor]::Position
      "$($pos.X),$($pos.Y)"
    `;
    const { stdout } = await execAsync('powershell', [
      '-NoProfile',
      '-Command',
      script,
    ]);
    const [x, y] = stdout.trim().split(',').map(Number);
    return { x, y };
  }

  async keyboardAction(action: KeyboardAction): Promise<void> {
    const script = this.buildKeyboardScript(action);
    await execAsync('powershell', ['-NoProfile', '-Command', script]);
  }

  async getClipboard(): Promise<string> {
    const script = 'Get-Clipboard -Raw';
    const { stdout } = await execAsync('powershell', [
      '-NoProfile',
      '-Command',
      script,
    ]);
    return stdout;
  }

  async setClipboard(text: string): Promise<void> {
    const encoded = Buffer.from(text, 'utf-8').toString('base64');
    const script = `[System.Windows.Forms.Clipboard]::SetText([System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')))`;
    await execAsync('powershell', [
      '-NoProfile',
      '-Command',
      `Add-Type -AssemblyName System.Windows.Forms; ${script}`,
    ]);
  }

  async getRunningApps(): Promise<AppInfo[]> {
    const script = `
      Get-Process | Where-Object {$_.MainWindowTitle} |
      Select-Object -First 50 Name,Id,MainWindowTitle |
      ConvertTo-Json -Compress
    `;
    const { stdout } = await execAsync('powershell', [
      '-NoProfile',
      '-Command',
      script,
    ]);
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
    const { stdout } = await execAsync('powershell', [
      '-NoProfile',
      '-Command',
      script,
    ]);
    const [name, pidStr] = stdout.trim().split(',');
    return { name, pid: parseInt(pidStr) };
  }

  async launchApp(bundleIdOrPath: string): Promise<boolean> {
    try {
      await execAsync('powershell', [
        '-NoProfile',
        '-Command',
        `Start-Process '${bundleIdOrPath}'`,
      ]);
      return true;
    } catch {
      return false;
    }
  }

  async activateApp(_bundleId: string): Promise<boolean> {
    return false;
  }

  async destroy(): Promise<void> {}

  private buildMouseScript(action: MouseAction): string {
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
          [Win32.Mouse]::mouse_event(0x0002, 0, 0, 0, 0)
          Start-Sleep -Milliseconds 50
          [Win32.Mouse]::mouse_event(0x0004, 0, 0, 0, 0)
        `;
      case 'rightClick':
        return `
          Add-Type -AssemblyName System.Windows.Forms
          Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);' -Name Mouse -Namespace Win32
          [Win32.Mouse]::mouse_event(0x0008, 0, 0, 0, 0)
          Start-Sleep -Milliseconds 50
          [Win32.Mouse]::mouse_event(0x0010, 0, 0, 0, 0)
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
      default:
        return '';
    }
  }
}
