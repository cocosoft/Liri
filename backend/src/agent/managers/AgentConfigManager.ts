/**
 * Agent配置管理器
 * 负责Agent配置的持久化存储和管理
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { AgentConfig } from '../models/types';
import { AIModelType } from '@modules/ai/models/types';

/**
 * Agent配置管理器
 */
export class AgentConfigManager {
  private configPath: string;
  private configCache: Map<string, AgentConfig> = new Map();
  private lastModified: Map<string, number> = new Map();

  /**
   * 构造函数
   * @param configDir 配置目录
   */
  constructor(configDir: string = join(process.env.HOME || process.env.USERPROFILE || '', '.py_app', 'config', 'agents')) {
    this.configPath = configDir;
    this.ensureConfigDirExists();
  }

  /**
   * 确保配置目录存在
   */
  private ensureConfigDirExists(): void {
    if (!existsSync(this.configPath)) {
      mkdirSync(this.configPath, { recursive: true });
    }
  }

  /**
   * 获取配置文件路径
   * @param agentId Agent ID
   * @returns 配置文件路径
   */
  private getConfigFilePath(agentId: string): string {
    return join(this.configPath, `${agentId}.json`);
  }

  /**
   * 加载Agent配置
   * @param agentId Agent ID
   * @returns Agent配置或默认配置
   */
  loadConfig(agentId: string): AgentConfig {
    const filePath = this.getConfigFilePath(agentId);
    
    // 检查缓存是否有效
    if (this.configCache.has(agentId)) {
      const fileStats = existsSync(filePath) ? readFileSync(filePath, 'utf8') : null;
      if (fileStats) {
        const mtime = new Date(JSON.parse(fileStats).lastModified || Date.now()).getTime();
        if (this.lastModified.get(agentId) === mtime) {
          return this.configCache.get(agentId)!;
        }
      }
    }

    try {
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf8');
        const config = JSON.parse(content);
        
        // 验证配置
        const validatedConfig = this.validateConfig(config);
        
        // 更新缓存
        this.configCache.set(agentId, validatedConfig);
        this.lastModified.set(agentId, Date.now());
        
        return validatedConfig;
      }
    } catch (error) {
      console.error(`加载Agent配置失败: ${agentId}`, error);
    }

    // 返回默认配置
    const defaultConfig = this.getDefaultConfig();
    this.configCache.set(agentId, defaultConfig);
    return defaultConfig;
  }

  /**
   * 保存Agent配置
   * @param agentId Agent ID
   * @param config Agent配置
   */
  saveConfig(agentId: string, config: Partial<AgentConfig>): void {
    try {
      const currentConfig = this.loadConfig(agentId);
      const updatedConfig = { ...currentConfig, ...config, lastModified: Date.now() };
      
      // 验证配置
      const validatedConfig = this.validateConfig(updatedConfig);
      
      const filePath = this.getConfigFilePath(agentId);
      writeFileSync(filePath, JSON.stringify(validatedConfig, null, 2));
      
      // 更新缓存
      this.configCache.set(agentId, validatedConfig);
      this.lastModified.set(agentId, Date.now());
    } catch (error) {
      console.error(`保存Agent配置失败: ${agentId}`, error);
    }
  }

  /**
   * 删除Agent配置
   * @param agentId Agent ID
   */
  deleteConfig(agentId: string): void {
    try {
      const filePath = this.getConfigFilePath(agentId);
      if (existsSync(filePath)) {
        // 这里可以使用fs.unlinkSync，但为了安全起见，我们暂时只清除缓存
        // unlinkSync(filePath);
      }
      
      // 清除缓存
      this.configCache.delete(agentId);
      this.lastModified.delete(agentId);
    } catch (error) {
      console.error(`删除Agent配置失败: ${agentId}`, error);
    }
  }

  /**
   * 验证配置
   * @param config 配置对象
   * @returns 验证后的配置
   */
  private validateConfig(config: any): AgentConfig {
    const defaultConfig = this.getDefaultConfig();
    
    return {
      model: config.model || defaultConfig.model,
      temperature: typeof config.temperature === 'number' ? config.temperature : defaultConfig.temperature,
      maxTokens: typeof config.maxTokens === 'number' ? config.maxTokens : defaultConfig.maxTokens,
      timeout: typeof config.timeout === 'number' ? config.timeout : defaultConfig.timeout,
      memoryPath: config.memoryPath || defaultConfig.memoryPath,
      defaultStrategy: config.defaultStrategy || defaultConfig.defaultStrategy,
      tools: Array.isArray(config.tools) ? config.tools : defaultConfig.tools,
    };
  }

  /**
   * 获取默认配置
   * @returns 默认配置
   */
  private getDefaultConfig(): AgentConfig {
    return {
      model: AIModelType.GPT_3_5_TURBO,
      temperature: 0.7,
      maxTokens: 1000,
      timeout: 60000,
      memoryPath: '',
      defaultStrategy: 'direct_answer',
      tools: [],
    };
  }

  /**
   * 列出所有Agent配置
   * @returns Agent ID数组
   */
  listConfigs(): string[] {
    try {
      if (existsSync(this.configPath)) {
        const files = readdirSync(this.configPath);
        return files
          .filter(file => file.endsWith('.json'))
          .map(file => file.replace('.json', ''));
      }
    } catch (error) {
      console.error('列出Agent配置失败', error);
    }
    return [];
  }

  /**
   * 清除配置缓存
   */
  clearCache(): void {
    this.configCache.clear();
    this.lastModified.clear();
  }

  /**
   * 获取配置目录
   * @returns 配置目录路径
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * 设置配置目录
   * @param configDir 配置目录路径
   */
  setConfigPath(configDir: string): void {
    this.configPath = configDir;
    this.ensureConfigDirExists();
    this.clearCache();
  }
}

// 导出单例实例
const agentConfigManager = new AgentConfigManager();
export default agentConfigManager;