/**
 * AudioDeviceManager
 * 音频设备选择管理
 *
 * 枚举系统音频输出/输入设备，提供设备选择接口和配置持久化。
 * 跨平台支持：Windows (PowerShell)、macOS (system_profiler)、Linux (pactl)
 *
 * 参考产品: codex-main tui/src/audio_device.rs
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { getPlatform } from '@modules/utils/platform';
import { resolvePyappHome, ensureDir } from '@modules/config/paths';

const logger = new Logger({ level: LogLevel.INFO });

/** 音频设备信息 */
export interface AudioDevice {
  id: string;
  name: string;
  type: 'playback' | 'capture';
  isDefault: boolean;
  isSystemDefault: boolean;
}

/** 音频设备配置持久化结构 */
export interface AudioDeviceConfig {
  preferredPlaybackDevice?: string;
  preferredCaptureDevice?: string;
}

/** 语音配置文件名 */
const VOICE_CONFIG_FILE = 'voice-config.json';

/**
 * 获取音频设备配置文件完整路径
 */
function getConfigFilePath(): string {
  const home = resolvePyappHome();
  return join(home, VOICE_CONFIG_FILE);
}

/**
 * 读取已持久化的音频设备配置
 */
function loadConfig(): AudioDeviceConfig {
  try {
    const configPath = getConfigFilePath();
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, 'utf-8');
      return JSON.parse(raw) as AudioDeviceConfig;
    }
  } catch (error) {
    logger.warn('读取音频设备配置失败，使用默认配置', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return {};
}

/**
 * 写入音频设备配置（原子写入）
 */
function saveConfig(config: AudioDeviceConfig): void {
  try {
    const configPath = getConfigFilePath();
    const configDir = resolvePyappHome();
    ensureDir(configDir);
    const tmpPath = configPath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8');
    // 原子替换
    const fs = require('fs');
    fs.renameSync(tmpPath, configPath);
  } catch (error) {
    logger.error('保存音频设备配置失败', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Windows: 通过 PowerShell 枚举音频端点
 */
function enumerateWindowsDevices(type: 'playback' | 'capture'): AudioDevice[] {
  const devices: AudioDevice[] = [];
  try {
    // 使用 Get-CimInstance 查询音频端点（避免 cmd 管道冲突）
    const psScript = `Get-CimInstance -Namespace "root/audio/soundart" -ClassName SoundAudioEndpoint | Select-Object Name, DeviceId, Role`;
    const output = execSync(
      `powershell -NoProfile -NonInteractive -Command "${psScript}"`,
      { encoding: 'utf-8', timeout: 5000 }
    );

    const lines = output.split('\n').filter(Boolean);
    for (const line of lines) {
      const trimmed = line.trim();
      // 跳过表头和分隔行
      if (!trimmed || trimmed.startsWith('Name') || trimmed.startsWith('---')) {
        continue;
      }
      const parts = trimmed.split(/\s{2,}/).filter(Boolean);
      if (parts.length >= 1) {
        const name = parts[0].trim();
        const deviceId = parts.length >= 2 ? parts[1].trim() : name;
        const role = parts.length >= 3 ? parts[2].trim().toLowerCase() : '';
        const isMatch =
          type === 'playback'
            ? role.includes('render') || role.includes('play')
            : role.includes('capture') || role.includes('record');
        if (isMatch) {
          devices.push({
            id: deviceId,
            name,
            type,
            isDefault: false,
            isSystemDefault: false,
          });
        }
      }
    }

    // 如果 CIM 查询失败，回退到 Get-PnpDevice + cmd 安全写法
    if (devices.length === 0) {
      const fallbackScript = `Get-PnpDevice -Class AudioEndpoint -Status OK | %%{ $_.FriendlyName }`;
      const fallbackOutput = execSync(
        `powershell -NoProfile -NonInteractive -Command "${fallbackScript}"`,
        { encoding: 'utf-8', timeout: 5000 }
      );
      const fallbackLines = fallbackOutput.split('\n').filter(Boolean);
      for (const line of fallbackLines) {
        const name = line.trim();
        if (name) {
          devices.push({
            id: name,
            name,
            type,
            isDefault: false,
            isSystemDefault: false,
          });
        }
      }
    }

    // 标记第一个设备为系统默认
    if (devices.length > 0) {
      devices[0].isSystemDefault = true;
      devices[0].isDefault = true;
    }
  } catch (error) {
    logger.warn('Windows 音频设备枚举失败', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return devices;
}

/**
 * macOS: 通过 system_profiler 枚举音频设备
 */
function enumerateMacOSDevices(type: 'playback' | 'capture'): AudioDevice[] {
  const devices: AudioDevice[] = [];
  try {
    const output = execSync('system_profiler SPAudioDataType 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 10000,
    });

    const lines = output.split('\n');
    let currentDevice: Partial<AudioDevice> | null = null;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('Audio Device:')) {
        if (currentDevice && currentDevice.name) {
          devices.push({
            id: currentDevice.id || currentDevice.name,
            name: currentDevice.name,
            type: currentDevice.type || type,
            isDefault: currentDevice.isDefault || false,
            isSystemDefault: currentDevice.isSystemDefault || false,
          });
        }
        currentDevice = { type, isDefault: false, isSystemDefault: false };
        currentDevice.name = trimmed.replace('Audio Device:', '').trim();
        currentDevice.id = currentDevice.name;
      } else if (currentDevice && trimmed.includes('Default Audio Device:')) {
        currentDevice.isSystemDefault = trimmed.includes('Yes');
        currentDevice.isDefault = currentDevice.isSystemDefault;
      } else if (currentDevice && trimmed.includes('Source:')) {
        const source = trimmed.replace('Source:', '').trim().toLowerCase();
        if (
          type === 'playback' &&
          (source.includes('output') || source.includes('speaker'))
        ) {
          currentDevice.type = 'playback';
        } else if (
          type === 'capture' &&
          (source.includes('input') || source.includes('mic'))
        ) {
          currentDevice.type = 'capture';
        }
      }
    }

    // 添加最后一个设备
    if (currentDevice && currentDevice.name) {
      devices.push({
        id: currentDevice.id || currentDevice.name,
        name: currentDevice.name,
        type: currentDevice.type || type,
        isDefault: currentDevice.isDefault || false,
        isSystemDefault: currentDevice.isSystemDefault || false,
      });
    }
  } catch (error) {
    logger.warn('macOS 音频设备枚举失败', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return devices;
}

/**
 * Linux: 通过 pactl 枚举音频设备
 */
function enumerateLinuxDevices(type: 'playback' | 'capture'): AudioDevice[] {
  const devices: AudioDevice[] = [];
  try {
    const sinkOrSource = type === 'playback' ? 'sinks' : 'sources';
    const output = execSync(
      `pactl list ${sinkOrSource} short 2>/dev/null || aplay -l 2>/dev/null`,
      { encoding: 'utf-8', timeout: 5000 }
    );

    // 尝试 pactl 格式
    const pactlLines = output.split('\n').filter(Boolean);
    for (const line of pactlLines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        const id = parts[0];
        const name = parts[1];
        devices.push({
          id: `alsa_output.${id}`,
          name: name || `Device ${id}`,
          type,
          isDefault: id === '0',
          isSystemDefault: id === '0',
        });
      }
    }

    // 如果 pactl 没有结果，尝试解析 aplay -l 输出
    if (devices.length === 0 && output.includes('card')) {
      const cardLines = output.split('\n').filter((l) => l.includes('card'));
      for (const line of cardLines) {
        const cardMatch = line.match(/card\s+(\d+):\s+(.+?)\[/);
        if (cardMatch) {
          devices.push({
            id: `hw:${cardMatch[1]}`,
            name: cardMatch[2].trim(),
            type,
            isDefault: cardMatch[1] === '0',
            isSystemDefault: cardMatch[1] === '0',
          });
        }
      }
    }
  } catch (error) {
    logger.warn('Linux 音频设备枚举失败', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return devices;
}

/**
 * 根据平台枚举音频设备
 */
function enumerateDevices(type: 'playback' | 'capture'): AudioDevice[] {
  const platform = getPlatform();

  switch (platform) {
    case 'win32':
      return enumerateWindowsDevices(type);
    case 'darwin':
      return enumerateMacOSDevices(type);
    case 'linux':
      return enumerateLinuxDevices(type);
    default:
      logger.warn(`不支持的平台: ${platform}，返回空设备列表`);
      return [];
  }
}

/**
 * AudioDeviceManager
 * 静态工具类，管理系统音频设备的选择和配置持久化
 */
export class AudioDeviceManager {
  /**
   * 列出所有可用的播放设备（扬声器/耳机）
   */
  static async listPlaybackDevices(): Promise<AudioDevice[]> {
    const devices = enumerateDevices('playback');
    const config = loadConfig();

    // 标记首选设备
    if (config.preferredPlaybackDevice) {
      for (const device of devices) {
        if (device.id === config.preferredPlaybackDevice) {
          device.isDefault = true;
        }
      }
    }

    return devices;
  }

  /**
   * 列出所有可用的录音设备（麦克风）
   */
  static async listCaptureDevices(): Promise<AudioDevice[]> {
    const devices = enumerateDevices('capture');
    const config = loadConfig();

    // 标记首选设备
    if (config.preferredCaptureDevice) {
      for (const device of devices) {
        if (device.id === config.preferredCaptureDevice) {
          device.isDefault = true;
        }
      }
    }

    return devices;
  }

  /**
   * 获取系统默认播放设备
   */
  static async getDefaultPlaybackDevice(): Promise<AudioDevice> {
    const devices = await AudioDeviceManager.listPlaybackDevices();
    const defaultDevice = devices.find((d) => d.isSystemDefault || d.isDefault);

    if (defaultDevice) {
      return defaultDevice;
    }

    // 回退到第一个可用设备
    if (devices.length > 0) {
      return devices[0];
    }

    // 无可枚举设备时，返回虚拟默认设备
    return {
      id: 'default',
      name: '系统默认设备',
      type: 'playback',
      isDefault: true,
      isSystemDefault: true,
    };
  }

  /**
   * 设置首选播放/录音设备
   * 配置会持久化到配置文件
   *
   * @param deviceId 设备 ID
   * @param type 设备类型
   */
  static setPreferredDevice(
    deviceId: string,
    type: 'playback' | 'capture'
  ): void {
    const config = loadConfig();

    if (type === 'playback') {
      config.preferredPlaybackDevice = deviceId;
    } else {
      config.preferredCaptureDevice = deviceId;
    }

    saveConfig(config);

    logger.info('已设置首选音频设备', { deviceId, type });
  }

  /**
   * 获取实际生效的播放/录音设备
   * 优先级：首选设备 → 系统默认设备 → 第一个可用设备 → 虚拟默认设备
   *
   * @param type 设备类型
   */
  static async getEffectiveDevice(
    type: 'playback' | 'capture'
  ): Promise<AudioDevice> {
    const config = loadConfig();
    const preferredId =
      type === 'playback'
        ? config.preferredPlaybackDevice
        : config.preferredCaptureDevice;

    const devices =
      type === 'playback'
        ? await AudioDeviceManager.listPlaybackDevices()
        : await AudioDeviceManager.listCaptureDevices();

    // 1. 首选设备可用
    if (preferredId) {
      const preferred = devices.find((d) => d.id === preferredId);
      if (preferred) {
        logger.debug('使用首选音频设备', { deviceId: preferredId, type });
        return preferred;
      }
      logger.warn('首选音频设备不可用，回退到系统默认', {
        preferredId,
        type,
      });
    }

    // 2. 系统默认设备
    const systemDefault = devices.find((d) => d.isSystemDefault);
    if (systemDefault) {
      return systemDefault;
    }

    // 3. 第一个可用设备
    if (devices.length > 0) {
      return devices[0];
    }

    // 4. 虚拟默认设备
    const defaultDevice: AudioDevice = {
      id: 'default',
      name: '系统默认设备',
      type,
      isDefault: true,
      isSystemDefault: true,
    };
    logger.warn('无可用音频设备，使用虚拟默认设备', { type });
    return defaultDevice;
  }
}
