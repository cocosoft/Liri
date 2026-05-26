/**
 * EnvironmentRuntimeDetector
 * 运行时环境检测器
 * 检测 SSH 会话、Docker 容器、WSL 等远程/受限环境
 * 对标 Hermes 的环境检测能力
 */

import { readFileSync, existsSync } from 'fs';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/** 运行时环境类型 */
export type RuntimeEnvironment =
  | 'local'
  | 'ssh'
  | 'docker'
  | 'wsl'
  | 'termux'
  | 'remote'
  | 'unknown';

/** 运行时环境检测结果 */
export interface RuntimeEnvironmentResult {
  environment: RuntimeEnvironment;
  isRemote: boolean;
  hasAudioDevice: boolean;
  details: {
    isSSH: boolean;
    isDocker: boolean;
    isWSL: boolean;
    isTermux: boolean;
    hasSSHAgent: boolean;
  };
}

/** 缓存检测结果，避免重复检测 */
let cachedResult: RuntimeEnvironmentResult | null = null;

/**
 * 检测是否在 SSH 会话中
 * SSH 环境变量检测链：SSH_CONNECTION → SSH_CLIENT → SSH_TTY
 */
export function isSSHSession(): boolean {
  return (
    isEnvVarTruthy('SSH_CONNECTION') ||
    isEnvVarTruthy('SSH_CLIENT') ||
    isEnvVarTruthy('SSH_TTY')
  );
}

/**
 * 检测是否在 Docker 容器中
 * 检测链：/.dockerenv → /proc/1/cgroup 中包含 docker
 */
export function isDockerContainer(): boolean {
  if (existsSync('/.dockerenv')) {
    return true;
  }

  try {
    if (existsSync('/proc/1/cgroup')) {
      const content = readFileSync('/proc/1/cgroup', 'utf8');
      if (content.includes('docker') || content.includes('containerd')) {
        return true;
      }
    }
  } catch {
    // 忽略读取错误
  }

  return false;
}

/**
 * 检测是否在 WSL 中
 */
export function isWSL(): boolean {
  try {
    if (!existsSync('/proc/version')) return false;
    const version = readFileSync('/proc/version', 'utf8');
    return version.includes('microsoft') || version.includes('WSL');
  } catch {
    return false;
  }
}

/**
 * 检测是否在 Termux 中
 */
function isTermux(): boolean {
  return (
    isEnvVarTruthy('PREFIX') &&
    (process.env.PREFIX ?? '').includes('com.termux')
  );
}

/**
 * 检测是否拥有 SSH Agent
 */
function hasSSHAgent(): boolean {
  return isEnvVarTruthy('SSH_AUTH_SOCK') || isEnvVarTruthy('SSH_AGENT_PID');
}

/**
 * 安全地检查环境变量是否被设置且不为空
 */
function isEnvVarTruthy(name: string): boolean {
  const val = process.env[name];
  return val !== undefined && val !== null && val !== '';
}

/**
 * 检测当前系统是否有音频设备
 */
function hasAudioDevice(): boolean {
  const platform = process.platform;

  if (platform === 'win32') {
    return true;
  }

  if (platform === 'darwin') {
    return true;
  }

  if (platform === 'linux') {
    try {
      if (existsSync('/proc/asound/cards')) {
        const cards = readFileSync('/proc/asound/cards', 'utf8');
        if (cards.trim() && !cards.includes('no soundcards')) {
          return true;
        }
      }
      if (existsSync('/dev/snd')) {
        return true;
      }
      if (isEnvVarTruthy('PULSE_SERVER') || isEnvVarTruthy('PULSE_COOKIE')) {
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  return false;
}

/**
 * 检测运行时环境
 * 按优先级判断：SSH → Docker → WSL → Termux → local
 */
export function detectRuntimeEnvironment(): RuntimeEnvironmentResult {
  if (cachedResult) {
    return cachedResult;
  }

  const ssh = isSSHSession();
  const docker = isDockerContainer();
  const wsl = isWSL();
  const termux = isTermux();
  const sshAgent = hasSSHAgent();

  let environment: RuntimeEnvironment = 'local';
  let isRemote = false;

  if (ssh) {
    environment = 'ssh';
    isRemote = true;
  } else if (docker) {
    environment = 'docker';
    isRemote = true;
  } else if (wsl) {
    environment = 'wsl';
    isRemote = true;
  } else if (termux) {
    environment = 'termux';
    isRemote = true;
  }

  const audioAvailable = hasAudioDevice();

  const result: RuntimeEnvironmentResult = {
    environment,
    isRemote,
    hasAudioDevice: audioAvailable,
    details: {
      isSSH: ssh,
      isDocker: docker,
      isWSL: wsl,
      isTermux: termux,
      hasSSHAgent: sshAgent,
    },
  };

  cachedResult = result;

  logger.info('Runtime environment detected', {
    environment: result.environment,
    isRemote: result.isRemote,
    hasAudioDevice: result.hasAudioDevice,
  });

  return result;
}

/**
 * 重置缓存（主要用于测试）
 */
export function resetRuntimeEnvironmentCache(): void {
  cachedResult = null;
}

/**
 * 检查语音功能在当前环境下是否可用
 * 远程环境（SSH/Docker）且无音频设备时不可用
 */
export function isVoiceAvailable(): boolean {
  const env = detectRuntimeEnvironment();
  return !env.isRemote || env.hasAudioDevice;
}
