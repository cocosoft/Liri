/**
 * 终端启动器
 *
 * 检测用户终端模拟器并在其中启动 Liri
 * 用于深度链接协议处理器（当 OS 调用时没有终端上下文）
 *
 * 平台支持:
 *   Windows — Windows Terminal (wt.exe), PowerShell, cmd.exe
 *   macOS   — Terminal.app, iTerm2, Ghostty, Kitty, Alacritty, WezTerm
 *   Linux   — ghostty, kitty, alacritty, wezterm, gnome-terminal, xterm
 *
 * 参考: cc_code/backend/utils/deepLink/terminalLauncher.ts
 */

import { spawn } from 'child_process';
import { configManager } from '@modules/config';
import { basename } from 'path';

import { handleError } from '@modules/error';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('utils:deepLink:TerminalLauncher');

export type TerminalInfo = {
  name: string;
  command: string;
};

export type LaunchOptions = {
  query?: string;
  cwd?: string;
  repo?: string;
  lastFetchMs?: number;
};

function shellEscape(value: string): string {
  const escaped = value.replace(/'/g, `'\\''`);
  return `'${escaped}'`;
}

function buildCliArgs(options: LaunchOptions): string[] {
  const args: string[] = [];

  if (options.query) {
    args.push('--prefill', options.query);
  }
  if (options.repo) {
    args.push('--repo', options.repo);
  }

  args.push('--deep-link-origin');

  if (options.lastFetchMs) {
    args.push('--last-fetch-ms', String(options.lastFetchMs));
  }

  return args;
}

async function isCommandAvailable(command: string): Promise<boolean> {
  try {
    const result = spawn(
      process.platform === 'win32' ? 'where' : 'which',
      [command],
      { stdio: 'ignore' }
    );
    return new Promise((resolve) => {
      result.on('close', (code) => resolve(code === 0));
      result.on('error', () => resolve(false));
    });
  } catch {
    return false;
  }
}

async function launchWindowsTerminal(
  execPath: string,
  options: LaunchOptions
): Promise<boolean> {
  const cliArgs = buildCliArgs(options);
  const cwd = options.cwd || process.cwd();

  // Try Windows Terminal first
  if (await isCommandAvailable('wt.exe')) {
    return new Promise((resolve) => {
      const child = spawn('wt.exe', ['-d', cwd, execPath, ...cliArgs], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });

      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
      child.unref();

      setTimeout(() => resolve(true), 1000);
    });
  }

  // Fall back to PowerShell
  if (await isCommandAvailable('powershell.exe')) {
    const cmdStr = `& '${execPath}' ${cliArgs.join(' ')}`;
    return new Promise((resolve) => {
      const child = spawn(
        'powershell.exe',
        ['-NoExit', '-Command', `cd '${cwd}'; ${cmdStr}`],
        {
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
        }
      );

      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
      child.unref();

      setTimeout(() => resolve(true), 1000);
    });
  }

  // Final fallback: cmd.exe
  const cmdStr = `cd /d "${cwd}" && "${execPath}" ${cliArgs.join(' ')}`;
  return new Promise((resolve) => {
    const child = spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', cmdStr], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });

    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
    child.unref();

    setTimeout(() => resolve(true), 1000);
  });
}

const MACOS_TERMINALS: Array<{ name: string; bundleId: string; app: string }> =
  [
    { name: 'iTerm2', bundleId: 'com.googlecode.iterm2', app: 'iTerm' },
    { name: 'Ghostty', bundleId: 'com.mitchellh.ghostty', app: 'Ghostty' },
    { name: 'Kitty', bundleId: 'net.kovidgoyal.kitty', app: 'kitty' },
    { name: 'Alacritty', bundleId: 'org.alacritty', app: 'Alacritty' },
    { name: 'WezTerm', bundleId: 'com.github.wez.wezterm', app: 'WezTerm' },
    { name: 'Terminal.app', bundleId: 'com.apple.Terminal', app: 'Terminal' },
  ];

async function launchMacosTerminal(
  execPath: string,
  options: LaunchOptions
): Promise<boolean> {
  const cliArgs = buildCliArgs(options);
  const cwd = options.cwd || process.cwd();
  const command = `cd ${shellEscape(cwd)} && ${shellEscape(execPath)} ${cliArgs.map(shellEscape).join(' ')}`;

  for (const terminal of MACOS_TERMINALS) {
    // Check if the terminal app is installed
    try {
      const checkSpawn = spawn('mdfind', [
        `kMDItemCFBundleIdentifier == "${terminal.bundleId}"`,
      ]);
      const found = await new Promise<boolean>((resolve) => {
        let data = '';
        checkSpawn.stdout?.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        checkSpawn.on('close', (code) =>
          resolve(code === 0 && data.trim().length > 0)
        );
        checkSpawn.on('error', () => resolve(false));
      });

      if (!found) continue;

      if (terminal.app === 'Terminal') {
        spawn(
          'open',
          ['-a', 'Terminal', '--args', '/bin/bash', '-c', command],
          {
            detached: true,
            stdio: 'ignore',
          }
        ).unref();
        return true;
      }

      if (terminal.app === 'iTerm') {
        spawn('open', ['-a', 'iTerm', '--args', command], {
          detached: true,
          stdio: 'ignore',
        }).unref();
        return true;
      }

      // Generic approach for other terminals
      spawn('open', ['-a', terminal.app, '--args', command], {
        detached: true,
        stdio: 'ignore',
      }).unref();
      return true;
    } catch {
      continue;
    }
  }

  return false;
}

const LINUX_TERMINALS = [
  'ghostty',
  'kitty',
  'alacritty',
  'wezterm',
  'gnome-terminal',
  'konsole',
  'xfce4-terminal',
  'mate-terminal',
  'tilix',
  'xterm',
];

async function launchLinuxTerminal(
  execPath: string,
  options: LaunchOptions
): Promise<boolean> {
  const cliArgs = buildCliArgs(options);
  const cwd = options.cwd || process.cwd();
  const command = `cd ${shellEscape(cwd)} && ${shellEscape(execPath)} ${cliArgs.map(shellEscape).join(' ')}`;

  for (const terminal of LINUX_TERMINALS) {
    if (!(await isCommandAvailable(terminal))) continue;

    try {
      spawn(terminal, ['-e', '/bin/bash', '-c', command], {
        detached: true,
        stdio: 'ignore',
      }).unref();
      return true;
    } catch {
      continue;
    }
  }

  // xterm fallback
  if (await isCommandAvailable('xterm')) {
    try {
      spawn('xterm', ['-e', '/bin/bash', '-c', command], {
        detached: true,
        stdio: 'ignore',
      }).unref();
      return true;
    } catch (err) {
      // last attempt failed

      handleError(err, {
        module: 'utils:deepLink:TerminalLauncher',
        action: 'lastAttemptFailed',
      });
    }
  }

  return false;
}

export async function launchInTerminal(
  execPath: string,
  options: LaunchOptions = {}
): Promise<boolean> {
  const platform = process.platform;

  if (platform === 'win32') {
    return launchWindowsTerminal(execPath, options);
  }

  if (platform === 'darwin') {
    return launchMacosTerminal(execPath, options);
  }

  if (platform === 'linux') {
    return launchLinuxTerminal(execPath, options);
  }

  return false;
}

export async function detectTerminal(): Promise<TerminalInfo | null> {
  if (process.platform === 'win32') {
    if (await isCommandAvailable('wt.exe')) {
      return { name: 'Windows Terminal', command: 'wt.exe' };
    }
    // Check if running in Windows Terminal via env
    if (configManager.env('WT_SESSION')) {
      return { name: 'Windows Terminal', command: 'wt.exe' };
    }
    return { name: 'PowerShell', command: 'powershell.exe' };
  }

  if (process.platform === 'darwin') {
    const termProgram = configManager.env('TERM_PROGRAM');
    if (termProgram) {
      const normalized = termProgram.replace(/\.app$/i, '').toLowerCase();
      const match = MACOS_TERMINALS.find(
        (t) => t.app.toLowerCase() === normalized
      );
      if (match) return { name: match.name, command: match.app };
    }
    return { name: 'Terminal.app', command: 'Terminal' };
  }

  if (process.platform === 'linux') {
    const term = configManager.env('TERM') || configManager.env('TERMINAL');
    if (term) {
      for (const t of LINUX_TERMINALS) {
        if (t === term || basename(term) === t) {
          return { name: t, command: t };
        }
      }
    }
    for (const t of LINUX_TERMINALS) {
      if (await isCommandAvailable(t)) {
        return { name: t, command: t };
      }
    }
    return null;
  }

  return null;
}
