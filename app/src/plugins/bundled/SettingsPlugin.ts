/**
 * 设置插件
 * 提供系统设置管理功能
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { Plugin, PluginMetadata } from '../types';
import { PluginStatus } from '../types/Plugin.js';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });
const SETTINGS_FILE = join(homedir(), '.pyapp', 'settings.json');

export interface SettingsConfig {
  theme: 'light' | 'dark' | 'system';
  language: string;
  fontSize: number;
  autoSave: boolean;
  notifications: boolean;
  telemetry: boolean;
}

export const SettingsPluginMetadata: PluginMetadata = {
  id: 'settings',
  name: 'Settings',
  version: '1.0.0',
  description: '设置插件，提供系统设置管理功能',
  author: 'PY_APP Team',
  category: 'core',
  dependencies: [],
  enabledByDefault: true,
};

export class SettingsPlugin implements Plugin {
  status: PluginStatus = PluginStatus.ENABLED;
  private enabled = true;
  private settings: SettingsConfig = {
    theme: 'system',
    language: 'zh-CN',
    fontSize: 14,
    autoSave: true,
    notifications: true,
    telemetry: false,
  };

  get metadata(): PluginMetadata {
    return SettingsPluginMetadata;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  async initialize(): Promise<void> {
    this.loadSettings();
    logger.info(`[SettingsPlugin] 初始化设置插件`);
  }

  async activate(): Promise<void> {
    this.enabled = true;
    logger.info(`[SettingsPlugin] 设置插件已激活`);
  }

  async deactivate(): Promise<void> {
    this.enabled = false;
    logger.info(`[SettingsPlugin] 设置插件已停用`);
  }

  async dispose(): Promise<void> {
    this.saveSettings();
    logger.info(`[SettingsPlugin] 设置插件已释放`);
  }

  /**
   * 获取所有设置
   */
  getSettings(): SettingsConfig {
    return { ...this.settings };
  }

  /**
   * 更新设置
   */
  updateSettings(config: Partial<SettingsConfig>): void {
    this.settings = { ...this.settings, ...config };
    this.saveSettings();
  }

  /**
   * 获取特定设置项
   */
  getSetting<K extends keyof SettingsConfig>(key: K): SettingsConfig[K] {
    return this.settings[key];
  }

  /**
   * 设置特定设置项
   */
  setSetting<K extends keyof SettingsConfig>(
    key: K,
    value: SettingsConfig[K]
  ): void {
    this.settings[key] = value;
    this.saveSettings();
  }

  /**
   * 重置为默认设置
   */
  resetToDefaults(): void {
    this.settings = {
      theme: 'system',
      language: 'zh-CN',
      fontSize: 14,
      autoSave: true,
      notifications: true,
      telemetry: false,
    };
    this.saveSettings();
  }

  private loadSettings(): void {
    try {
      if (existsSync(SETTINGS_FILE)) {
        const saved = readFileSync(SETTINGS_FILE, 'utf-8');
        const parsed = JSON.parse(saved);
        this.settings = { ...this.settings, ...parsed };
      }
    } catch {
      // 使用默认设置
    }
  }

  private saveSettings(): void {
    try {
      const dir = join(homedir(), '.pyapp');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(
        SETTINGS_FILE,
        JSON.stringify(this.settings, null, 2),
        'utf-8'
      );
    } catch {
      // 保存失败，忽略
    }
  }
}

export function createSettingsPlugin(): Plugin {
  return new SettingsPlugin();
}
