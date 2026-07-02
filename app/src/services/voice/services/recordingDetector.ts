/**
 * RecordingDetector
 * 录音环境与依赖检测
 *
 * 提供录音可用性检测、平台录音工具发现等功能。
 * 从 voiceService.ts 提取，聚焦于"能否录音"的判断逻辑。
 */

import { spawnSync, spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { getPlatform } from '@modules/utils/platform';
import { Logger } from '@modules/monitoring';
import { isEnvTruthy } from '@modules/utils/envUtils';
import { configManager } from '@modules/config';
import type { VoiceDependencies } from '../models/types';

const logger = new Logger({ module: 'voice:recording:detector' });

// ===========================================================
// 常量
// ===========================================================

export const RECORDING_SAMPLE_RATE = 16000;
export const RECORDING_CHANNELS = 1;
export const RECORDING_BITS_PER_SAMPLE = 16;
export const SILENCE_DURATION_SECS = '2.0';
export const SILENCE_THRESHOLD = '3%';

// ===========================================================
// 工具函数
// ===========================================================

/**
 * 检查命令是否存在于 PATH 中
 */
export function hasCommand(cmd: string): boolean {
  const isWindows = process.platform === 'win32';
  const searchCmd = isWindows ? 'where' : 'which';
  const result = spawnSync(searchCmd, [cmd], {
    stdio: 'ignore',
    timeout: 3000,
  });
  return result.error === undefined;
}

/**
 * arecord 探测结果
 */
type ArecordProbeResult = { ok: boolean; stderr: string };
let arecordProbe: Promise<ArecordProbeResult> | null = null;

/**
 * 探测 arecord 是否可用（验证实际录音能力）
 */
export function probeArecord(): Promise<ArecordProbeResult> {
  arecordProbe ??= new Promise((resolve) => {
    const child = spawn(
      'arecord',
      [
        '-f',
        'S16_LE',
        '-r',
        String(RECORDING_SAMPLE_RATE),
        '-c',
        String(RECORDING_CHANNELS),
        '-t',
        'raw',
        '/dev/null',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(
      (c: typeof child, r: (v: ArecordProbeResult) => void) => {
        c.kill('SIGTERM');
        r({ ok: true, stderr: '' });
      },
      150,
      child,
      resolve
    );
    child.once('close', (code) => {
      clearTimeout(timer);
      void resolve({ ok: code === 0, stderr: stderr.trim() });
    });
    child.once('error', () => {
      clearTimeout(timer);
      void resolve({ ok: false, stderr: 'arecord: command not found' });
    });
  });
  return arecordProbe;
}

/**
 * 检查 Linux 是否有 ALSA 声卡
 */
let linuxAlsaCardsMemo: Promise<boolean> | null = null;

export function linuxHasAlsaCards(): Promise<boolean> {
  linuxAlsaCardsMemo ??= readFile('/proc/asound/cards', 'utf8').then(
    (cards) => {
      const c = cards.trim();
      return c !== '' && !c.includes('no soundcards');
    },
    () => false
  );
  return linuxAlsaCardsMemo;
}

/**
 * 包管理器信息
 */
type PackageManagerInfo = {
  cmd: string;
  args: string[];
  displayCommand: string;
};

/**
 * 检测当前系统的包管理器
 */
export function detectPackageManager(): PackageManagerInfo | null {
  if (process.platform === 'darwin') {
    if (hasCommand('brew')) {
      return {
        cmd: 'brew',
        args: ['install', 'sox'],
        displayCommand: 'brew install sox',
      };
    }
    return null;
  }

  if (process.platform === 'linux') {
    if (hasCommand('apt-get')) {
      return {
        cmd: 'sudo',
        args: ['apt-get', 'install', '-y', 'sox'],
        displayCommand: 'sudo apt-get install sox',
      };
    }
    if (hasCommand('dnf')) {
      return {
        cmd: 'sudo',
        args: ['dnf', 'install', '-y', 'sox'],
        displayCommand: 'sudo dnf install sox',
      };
    }
    if (hasCommand('pacman')) {
      return {
        cmd: 'sudo',
        args: ['pacman', '-S', '--noconfirm', 'sox'],
        displayCommand: 'sudo pacman -S sox',
      };
    }
  }

  return null;
}

// ===========================================================
// 录音可用性检测
// ===========================================================

/**
 * 检测各平台可用的录音方法
 *
 * 检测链：Windows → ffmpeg → SoundRecorder（内置）→ PowerShell（终极回退）
 * macOS → SoX；Linux → arecord → SoX
 *
 * @returns 录音依赖检测结果
 */
export async function checkVoiceDependencies(): Promise<VoiceDependencies> {
  const missing: string[] = [];
  let method: string | null = null;

  if (process.platform === 'win32') {
    if (hasCommand('ffmpeg') || hasCommand('ffmpeg.exe')) {
      method = 'ffmpeg';
    } else if (hasCommand('sox') || hasCommand('sox.exe')) {
      method = 'sox';
    } else {
      method = 'powershell';
    }
    return { available: true, missing: [], installCommand: null, method };
  }

  if (process.platform === 'darwin') {
    if (hasCommand('sox')) {
      method = 'sox';
    } else {
      missing.push('sox');
      return {
        available: false,
        missing,
        installCommand: hasCommand('brew')
          ? 'brew install sox'
          : 'Install SoX from https://sox.sourceforge.net/',
        method: null,
      };
    }
    return { available: true, missing: [], installCommand: null, method };
  }

  if (process.platform === 'linux') {
    if (hasCommand('sox')) {
      method = 'sox';
    } else if (hasCommand('arecord')) {
      method = 'arecord';
    } else {
      missing.push('sox or arecord');
      let installCmd: string | null = null;
      if (hasCommand('apt-get')) {
        installCmd = 'sudo apt-get install -y sox';
      } else if (hasCommand('dnf')) {
        installCmd = 'sudo dnf install -y sox';
      } else if (hasCommand('pacman')) {
        installCmd = 'sudo pacman -S sox';
      }
      return {
        available: false,
        missing,
        installCommand: installCmd,
        method: null,
      };
    }
    return { available: true, missing: [], installCommand: null, method };
  }

  return {
    available: false,
    missing: ['unsupported platform'],
    installCommand: null,
    method: null,
  };
}

/**
 * 检查录音可用性（包含更详细的环境检测）
 *
 * 在 checkVoiceDependencies 基础上增加远程环境检测和 arecord 实际探测。
 *
 * @returns 录音可用性结果
 */
export async function checkRecordingAvailability(): Promise<VoiceDependencies> {
  if (isEnvTruthy(configManager.env('Liri_REMOTE'))) {
    return {
      available: false,
      missing: [],
      installCommand: null,
      method: null,
      reason:
        'Voice mode requires microphone access, but no audio device is available in this environment.\n\nTo use voice mode, run Liri locally instead.',
    };
  }

  const dependencies = await checkVoiceDependencies();
  if (!dependencies.available) {
    return {
      ...dependencies,
      reason:
        dependencies.missing.join(', ') +
        (dependencies.installCommand
          ? `\n\nInstall with: ${dependencies.installCommand}`
          : ''),
    };
  }

  if (process.platform === 'linux' && dependencies.method === 'arecord') {
    const probe = await probeArecord();
    if (!probe.ok) {
      if (getPlatform() === 'wsl') {
        return {
          available: false,
          missing: [],
          installCommand: null,
          method: null,
          reason:
            'Voice mode could not access an audio device in WSL.\n\nWSL2 with WSLg (Windows 11) provides audio via PulseAudio — if you are on Windows 10 or WSL1, run Liri in native Windows instead.',
        };
      }
    }
  }

  return {
    available: true,
    missing: [],
    installCommand: null,
    method: null,
    reason: null,
  };
}
