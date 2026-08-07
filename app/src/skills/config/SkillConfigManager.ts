/**
 * SkillConfigManager 技能源配置管理
 * 管理技能源（本地、插件、MCP、项目）的配置
 */
import fs from 'fs';
import path from 'path';
import { resolvePyappHome } from '@modules/core';
import { configManager } from '@modules/config';

/**
 * 技能源类型
 */
export type SkillSourceType = 'user' | 'project' | 'plugin' | 'mcp' | 'bundled';

/**
 * 技能源配置
 */
export interface SkillSourceConfig {
  name: string;
  type: SkillSourceType;
  enabled: boolean;
  path: string;
  priority: number;
  autoLoad: boolean;
  options?: Record<string, unknown>;
}

/**
 * 技能配置选项
 */
export interface SkillConfigOptions {
  maxConcurrentExecutions: number;
  defaultTimeout: number;
  enableCache: boolean;
  enableTelemetry: boolean;
  allowedSources: SkillSourceType[];
}

/**
 * 技能源配置管理器
 */
export class SkillConfigManager {
  private sources: Map<string, SkillSourceConfig> = new Map();
  private configOptions: SkillConfigOptions;
  private configPath: string;

  constructor() {
    this.configOptions = {
      maxConcurrentExecutions: 5,
      defaultTimeout: 60000,
      enableCache: true,
      enableTelemetry: false,
      allowedSources: ['user', 'project', 'plugin', 'mcp', 'bundled'],
    };
    const effectiveCwd = configManager.env('LIRI_PROJECT_DIR') || process.cwd();
    this.configPath = path.join(resolvePyappHome(), 'skill-config.json');
    this.loadDefaults();
  }

  /**
   * 注册技能源
   */
  registerSource(config: SkillSourceConfig): void {
    this.sources.set(config.name, config);
  }

  /**
   * 注销技能源
   */
  unregisterSource(name: string): boolean {
    return this.sources.delete(name);
  }

  /**
   * 获取技能源配置
   */
  getSource(name: string): SkillSourceConfig | undefined {
    return this.sources.get(name);
  }

  /**
   * 获取所有技能源
   */
  getAllSources(): SkillSourceConfig[] {
    return Array.from(this.sources.values());
  }

  /**
   * 获取启用的技能源
   */
  getEnabledSources(): SkillSourceConfig[] {
    return Array.from(this.sources.values())
      .filter((s) => s.enabled)
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * 启用/禁用技能源
   */
  setSourceEnabled(name: string, enabled: boolean): boolean {
    const source = this.sources.get(name);
    if (!source) return false;
    source.enabled = enabled;
    return true;
  }

  /**
   * 更新技能源优先级
   */
  setSourcePriority(name: string, priority: number): boolean {
    const source = this.sources.get(name);
    if (!source) return false;
    source.priority = priority;
    return true;
  }

  /**
   * 获取全局配置
   */
  getOptions(): SkillConfigOptions {
    return { ...this.configOptions };
  }

  /**
   * 更新全局配置
   */
  updateOptions(options: Partial<SkillConfigOptions>): void {
    Object.assign(this.configOptions, options);
  }

  /**
   * 从文件加载配置
   */
  loadFromFile(filePath?: string): boolean {
    const targetPath = filePath || this.configPath;

    try {
      if (fs.existsSync(targetPath)) {
        const data = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
        if (data.sources) {
          for (const src of data.sources) {
            this.registerSource(src);
          }
        }
        if (data.options) {
          this.updateOptions(data.options);
        }
        return true;
      }
    } catch {
      // @ignore-catch — 配置读写失败返回 false（非关键路径，失败按未配置处理）
      return false;
    }

    return false;
  }

  /**
   * 保存配置到文件
   */
  saveToFile(filePath?: string): boolean {
    const targetPath = filePath || this.configPath;

    try {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      const data = {
        sources: Array.from(this.sources.values()),
        options: this.configOptions,
      };
      fs.writeFileSync(targetPath, JSON.stringify(data, null, 2), 'utf-8');
      return true;
    } catch {
      // @ignore-catch — 配置读写失败返回 false（非关键路径，失败按未配置处理）
      return false;
    }
  }

  /**
   * 加载默认配置
   */
  private loadDefaults(): void {
    const effectiveCwd = configManager.env('LIRI_PROJECT_DIR') || process.cwd();

    this.registerSource({
      name: 'builtin',
      type: 'bundled',
      enabled: true,
      path: path.join(effectiveCwd, 'skills', 'builtin'),
      priority: 0,
      autoLoad: true,
    });

    this.registerSource({
      name: 'bundled',
      type: 'bundled',
      enabled: true,
      path: path.join(effectiveCwd, 'skills', 'bundled'),
      priority: 10,
      autoLoad: true,
    });

    this.registerSource({
      name: 'user-skills',
      type: 'user',
      enabled: false,
      path: path.join(resolvePyappHome(), 'skills'),
      priority: 50,
      autoLoad: false,
    });
  }
}

export const skillConfigManager = new SkillConfigManager();
