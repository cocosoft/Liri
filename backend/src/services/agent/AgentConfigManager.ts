//
/**
 * Agent配置管理器
 * 实现基于文件系统的配置管理
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '@modules/utils/log';
import { CustomAgentDefinition, SettingSource } from './types';
import { parseAgentsFromJson } from './parseAgent';
import { getCwd } from '@modules/utils/cwd';
import { getConfigHomeDir } from '@modules/utils/envUtils';

type NonPluginSource = Exclude<SettingSource, 'built-in' | 'plugin'>;

/**
 * Agent配置管理器
 */
export class AgentConfigManager {
  private configCache: Map<string, { configs: CustomAgentDefinition[]; timestamp: number }> = new Map();
  private configWatchers: Map<string, fs.FSWatcher> = new Map();

  /**
   * 加载指定源的Agent配置
   */
  async loadConfigsFromSource(source: NonPluginSource): Promise<CustomAgentDefinition[]> {
    const cacheKey = `config_${source}`;
    const configPath = this.getConfigPathForSource(source);

    // 检查缓存
    const cached = this.configCache.get(cacheKey);
    const fileStat = fs.existsSync(configPath) ? fs.statSync(configPath) : null;
    
    if (cached && fileStat && cached.timestamp >= fileStat.mtimeMs) {
      return cached.configs;
    }

    try {
      if (!fs.existsSync(configPath)) {
        return [];
      }

      const configContent = fs.readFileSync(configPath, 'utf8');
      const configData = JSON.parse(configContent);
      const agents = parseAgentsFromJson(configData, source);

      // 更新缓存
      this.configCache.set(cacheKey, {
        configs: agents,
        timestamp: Date.now()
      });

      // 设置文件监视器
      this.setupConfigWatcher(configPath, source);

      return agents;
    } catch (error) {
      logger.error(`Failed to load configs from ${source}:`, error as Error);
      return [];
    }
  }

  /**
   * 保存Agent配置到指定源
   */
  async saveConfigsToSource(source: SettingSource, agents: CustomAgentDefinition[]): Promise<boolean> {
    try {
      const configPath = this.getConfigPathForSource(source);
      
      // 确保目录存在
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 转换Agent定义为可序列化的格式
      const configData = agents.reduce((acc, agent) => {
        acc[agent.agentType] = {
          description: agent.whenToUse,
          tools: agent.tools,
          disallowedTools: agent.disallowedTools,
          prompt: agent.getSystemPrompt(),
          model: agent.model,
          effort: agent.effort,
          permissionMode: agent.permissionMode,
          mcpServers: agent.mcpServers,
          hooks: agent.hooks,
          maxTurns: agent.maxTurns,
          skills: agent.skills,
          initialPrompt: agent.initialPrompt,
          background: agent.background,
          memory: agent.memory,
          isolation: agent.isolation
        };
        return acc;
      }, {} as Record<string, any>);

      // 写入文件
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8');

      // 清除缓存
      const cacheKey = `config_${source}`;
      this.configCache.delete(cacheKey);

      return true;
    } catch (error) {
      logger.error(`Failed to save configs to ${source}:`, error as Error);
      return false;
    }
  }

  /**
   * 获取指定源的配置文件路径
   */
  private getConfigPathForSource(source: SettingSource): string {
    const configHome = getConfigHomeDir();
    
    switch (source) {
      case 'userSettings':
        return path.join(configHome, 'agents.json');
      case 'projectSettings':
        return path.join(getCwd(), '.py_app', 'agents.json');
      case 'policySettings':
        return path.join(configHome, 'managed', 'agents.json');
      case 'flagSettings':
        return path.join(configHome, 'flags', 'agents.json');
      default:
        return path.join(configHome, 'agents.json');
    }
  }

  /**
   * 设置配置文件监视器
   */
  private setupConfigWatcher(configPath: string, source: SettingSource): void {
    // 清除现有的监视器
    if (this.configWatchers.has(configPath)) {
      this.configWatchers.get(configPath)?.close();
    }

    // 创建新的监视器
    const watcher = fs.watch(configPath, (eventType) => {
      if (eventType === 'change') {
        logger.debug(`Config file changed: ${configPath}`);
        // 清除缓存
        const cacheKey = `config_${source}`;
        this.configCache.delete(cacheKey);
      }
    });

    this.configWatchers.set(configPath, watcher);
  }

  /**
   * 验证Agent配置
   */
  validateAgentConfig(agent: CustomAgentDefinition): boolean {
    try {
      // 验证必需字段
      if (!agent.agentType || typeof agent.agentType !== 'string') {
        logger.debug('Invalid agent: missing or invalid agentType');
        return false;
      }
      if (!agent.whenToUse || typeof agent.whenToUse !== 'string') {
        logger.debug('Invalid agent: missing or invalid whenToUse');
        return false;
      }
      if (!agent.getSystemPrompt || typeof agent.getSystemPrompt !== 'function') {
        logger.debug('Invalid agent: missing or invalid getSystemPrompt');
        return false;
      }

      // 验证可选字段
      if (agent.tools && !Array.isArray(agent.tools)) {
        logger.debug('Invalid agent: tools must be an array');
        return false;
      }
      if (agent.disallowedTools && !Array.isArray(agent.disallowedTools)) {
        logger.debug('Invalid agent: disallowedTools must be an array');
        return false;
      }
      if (agent.skills && !Array.isArray(agent.skills)) {
        logger.debug('Invalid agent: skills must be an array');
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Error validating agent config:', error as Error);
      return false;
    }
  }

  /**
   * 清除所有缓存
   */
  clearCache(): void {
    this.configCache.clear();
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    // 关闭所有文件监视器
    for (const watcher of this.configWatchers.values()) {
      watcher.close();
    }
    this.configWatchers.clear();
    this.clearCache();
  }
}

// 单例实例
export const agentConfigManager = new AgentConfigManager();
