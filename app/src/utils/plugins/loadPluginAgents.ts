//
/**
 * 从插件加载Agent定义
 */

import * as fs from 'fs';
import * as path from 'path';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'utils:loadPluginAgents',
  level: LogLevel.INFO,
});
import { PluginAgentDefinition } from '@modules/services/agent/types';
import {
  parseAgentFromMarkdown,
  parseAgentsFromJson,
} from '@modules/services/agent/parseAgent';
import { pluginLoader } from '@modules/plugins/PluginLoader';
import type { LoadedPlugin } from '@modules/types/plugin';

// 缓存插件Agent
let pluginAgentsCache: PluginAgentDefinition[] | null = null;

/**
 * 从插件加载Agent定义
 */
export async function loadPluginAgents(): Promise<PluginAgentDefinition[]> {
  // 检查缓存
  if (pluginAgentsCache) {
    return pluginAgentsCache;
  }

  try {
    // 获取已安装的插件
    const plugins = await getInstalledPlugins();
    const agents: PluginAgentDefinition[] = [];

    for (const plugin of plugins) {
      const pluginAgents = await loadAgentsFromPlugin(plugin);
      agents.push(...pluginAgents);
    }

    // 更新缓存
    pluginAgentsCache = agents;
    return agents;
  } catch (error) {
    logger.error('Failed to load plugin agents:', error as Error);
    return [];
  }
}

/**
 * 获取已安装的插件
 */
async function getInstalledPlugins(): Promise<LoadedPlugin[]> {
  // 这里应该从插件配置或存储中获取已安装的插件
  // 暂时返回空数组，实际实现需要根据插件系统的具体设计
  return [];
}

/**
 * 从单个插件加载Agent定义
 */
async function loadAgentsFromPlugin(
  plugin: LoadedPlugin
): Promise<PluginAgentDefinition[]> {
  const agents: PluginAgentDefinition[] = [];

  try {
    // 检查插件的agentsPath和agentsPaths
    const agentPaths = [];

    if (plugin.agentsPaths) {
      agentPaths.push(...plugin.agentsPaths);
    }

    // 检查默认路径
    const defaultAgentPath = path.join(plugin.path, 'agents');
    if (
      fs.existsSync(defaultAgentPath) &&
      fs.statSync(defaultAgentPath).isDirectory()
    ) {
      agentPaths.push(defaultAgentPath);
    }

    // 从每个路径加载Agent
    for (const agentPath of agentPaths) {
      const absolutePath = path.isAbsolute(agentPath)
        ? agentPath
        : path.join(plugin.path, agentPath);

      if (fs.existsSync(absolutePath)) {
        if (fs.statSync(absolutePath).isDirectory()) {
          // 从目录加载
          const dirAgents = await loadAgentsFromDirectory(absolutePath, plugin);
          agents.push(...dirAgents);
        } else if (absolutePath.endsWith('.json')) {
          // 从JSON文件加载
          const jsonAgents = loadAgentsFromJson(absolutePath, plugin);
          agents.push(...jsonAgents);
        }
      }
    }

    return agents;
  } catch (error) {
    logger.error(
      `Failed to load agents from plugin ${plugin.name}:`,
      error as Error
    );
    return [];
  }
}

/**
 * 从目录加载Agent定义
 */
async function loadAgentsFromDirectory(
  directory: string,
  plugin: LoadedPlugin
): Promise<PluginAgentDefinition[]> {
  const agents: PluginAgentDefinition[] = [];

  try {
    const files = fs.readdirSync(directory);

    for (const file of files) {
      const filePath = path.join(directory, file);

      if (fs.statSync(filePath).isFile()) {
        if (file.endsWith('.md')) {
          // 从Markdown文件加载
          const agent = await loadAgentFromMarkdownFile(filePath, plugin);
          if (agent) {
            agents.push(agent);
          }
        } else if (file.endsWith('.json')) {
          // 从JSON文件加载
          const jsonAgents = loadAgentsFromJson(filePath, plugin);
          agents.push(...jsonAgents);
        }
      }
    }

    return agents;
  } catch (error) {
    logger.error(
      `Failed to load agents from directory ${directory}:`,
      error as Error
    );
    return [];
  }
}

/**
 * 从Markdown文件加载Agent定义
 */
async function loadAgentFromMarkdownFile(
  filePath: string,
  plugin: LoadedPlugin
): Promise<PluginAgentDefinition | null> {
  try {
    const content = fs.readFileSync(filePath, 'utf8');

    // 解析frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!frontmatterMatch) {
      return null;
    }

    const frontmatterContent = frontmatterMatch[1];
    const agentContent = frontmatterMatch[2];

    // 解析frontmatter为对象
    const frontmatter = parseFrontmatter(frontmatterContent);
    const baseDir = path.dirname(filePath);

    // 使用parseAgentFromMarkdown解析
    const agent = parseAgentFromMarkdown(
      filePath,
      baseDir,
      frontmatter,
      agentContent,
      'userSettings'
    );

    if (agent) {
      // 转换为PluginAgentDefinition
      const pluginAgent: PluginAgentDefinition = {
        ...agent,
        source: 'plugin',
        plugin: plugin.name,
      };

      return pluginAgent;
    }

    return null;
  } catch (error) {
    logger.error(
      `Failed to load agent from markdown file ${filePath}:`,
      error as Error
    );
    return null;
  }
}

/**
 * 从JSON文件加载Agent定义
 */
function loadAgentsFromJson(
  filePath: string,
  plugin: LoadedPlugin
): PluginAgentDefinition[] {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(content);

    const agents = parseAgentsFromJson(data, 'plugin' as unknown as never);

    // 转换为PluginAgentDefinition
    return agents.map((agent) => ({
      ...agent,
      source: 'plugin',
      plugin: plugin.name,
    }));
  } catch (error) {
    logger.error(
      `Failed to load agents from json file ${filePath}:`,
      error as Error
    );
    return [];
  }
}

/**
 * 解析frontmatter
 */
function parseFrontmatter(content: string): Record<string, unknown> {
  const frontmatter: Record<string, unknown> = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const match = line.match(/^([^:]+):\s*(.+)$/);
    if (match) {
      const [, key, value] = match;
      // 简单解析，实际实现可能需要更复杂的逻辑
      frontmatter[key.trim()] = value.trim();
    }
  }

  return frontmatter;
}

/**
 * 清除插件Agent缓存
 */
export function clearPluginAgentCache(): void {
  pluginAgentsCache = null;
}
