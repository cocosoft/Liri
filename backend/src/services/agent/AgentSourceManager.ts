//
/**
 * Agent源管理器
 * 支持从多个源加载Agent定义
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '@modules/utils/log';
import { AgentDefinition, BuiltInAgentDefinition, CustomAgentDefinition, PluginAgentDefinition } from './types';
import { getBuiltInAgents } from './builtInAgents';
import { loadPluginAgents } from '@modules/utils/plugins/loadPluginAgents';
import { loadMarkdownFilesForSubdir } from '@modules/utils/markdownConfigLoader';
import { parseAgentFromMarkdown } from './parseAgent';
import { getCwd } from '@modules/utils/cwd';

export type SettingSource = 'userSettings' | 'projectSettings' | 'policySettings' | 'flagSettings' | 'plugin' | 'built-in';

export type AgentSourceGroup = {
  label: string;
  source: SettingSource;
};

export const AGENT_SOURCE_GROUPS: AgentSourceGroup[] = [
  { label: 'Built-in Agents', source: 'built-in' },
  { label: 'Plugin Agents', source: 'plugin' },
  { label: 'User Agents', source: 'userSettings' },
  { label: 'Project Agents', source: 'projectSettings' },
  { label: 'Flag Agents', source: 'flagSettings' },
  { label: 'Managed Agents', source: 'policySettings' },
];

/**
 * Agent源管理器
 */
export class AgentSourceManager {
  private cachedAgents: Map<string, AgentDefinition[]> = new Map();

  /**
   * 从所有源加载Agent定义
   */
  async loadAllAgents(cwd: string = getCwd()): Promise<AgentDefinition[]> {
    try {
      // 并行加载不同源的Agent
      const [builtInAgents, pluginAgents, customAgents] = await Promise.all([
        this.loadBuiltInAgents(),
        this.loadPluginAgents(),
        this.loadCustomAgents(cwd)
      ]);

      const allAgents: AgentDefinition[] = [
        ...builtInAgents,
        ...pluginAgents,
        ...customAgents
      ];

      return allAgents;
    } catch (error) {
      logger.error('Failed to load agents from all sources:', error);
      // 即使出错也要返回内置Agent
      return this.loadBuiltInAgents();
    }
  }

  /**
   * 加载内置Agent
   */
  private loadBuiltInAgents(): BuiltInAgentDefinition[] {
    return getBuiltInAgents();
  }

  /**
   * 加载插件Agent
   */
  private async loadPluginAgents(): Promise<PluginAgentDefinition[]> {
    try {
      return await loadPluginAgents();
    } catch (error) {
      logger.error('Failed to load plugin agents:', error);
      return [];
    }
  }

  /**
   * 加载自定义Agent（用户、项目、管理）
   */
  private async loadCustomAgents(cwd: string): Promise<CustomAgentDefinition[]> {
    try {
      const markdownFiles = await loadMarkdownFilesForSubdir('agents', cwd);
      
      const customAgents = markdownFiles
        .map(({ filePath, baseDir, frontmatter, content, source }) => {
          const agent = parseAgentFromMarkdown(
            filePath,
            baseDir,
            frontmatter,
            content,
            source as SettingSource
          );
          if (!agent) {
            // 跳过非Agent文件
            if (!frontmatter['name']) {
              return null;
            }
            logger.debug(`Failed to parse agent from ${filePath}`);
            return null;
          }
          return agent;
        })
        .filter((agent): agent is CustomAgentDefinition => agent !== null);

      return customAgents;
    } catch (error) {
      logger.error('Failed to load custom agents:', error);
      return [];
    }
  }

  /**
   * 获取活跃的Agent列表（基于优先级）
   */
  getActiveAgents(allAgents: AgentDefinition[]): AgentDefinition[] {
    const builtInAgents = allAgents.filter(a => a.source === 'built-in');
    const pluginAgents = allAgents.filter(a => a.source === 'plugin');
    const userAgents = allAgents.filter(a => a.source === 'userSettings');
    const projectAgents = allAgents.filter(a => a.source === 'projectSettings');
    const managedAgents = allAgents.filter(a => a.source === 'policySettings');
    const flagAgents = allAgents.filter(a => a.source === 'flagSettings');

    // 按优先级排序：内置 < 插件 < 用户 < 项目 < 标志 < 管理
    const agentGroups = [
      builtInAgents,
      pluginAgents,
      userAgents,
      projectAgents,
      flagAgents,
      managedAgents
    ];

    const agentMap = new Map<string, AgentDefinition>();

    // 后加载的Agent会覆盖先加载的
    for (const agents of agentGroups) {
      for (const agent of agents) {
        agentMap.set(agent.agentType, agent);
      }
    }

    return Array.from(agentMap.values());
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cachedAgents.clear();
  }
}

// 单例实例
export const agentSourceManager = new AgentSourceManager();
