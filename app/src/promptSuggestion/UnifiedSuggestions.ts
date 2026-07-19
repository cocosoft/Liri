/**
 * Unified Suggestions 统一建议生成模块
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import {
  MAX_UNIFIED_SUGGESTIONS,
  DESCRIPTION_MAX_LENGTH,
  type SuggestionItem,
  type UnifiedSuggestionSource,
  type FileSuggestionSource,
  type McpResourceSuggestionSource,
  type AgentSuggestionSource,
  type CommandSuggestionSource,
  type AgentDefinition,
  type ServerResource,
} from './types';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'promptSuggestion:UnifiedSuggestions',
  level: LogLevel.INFO,
});

/**
 * 截断描述文本
 */
function truncateDescription(description: string): string {
  if (description.length <= DESCRIPTION_MAX_LENGTH) {
    return description;
  }
  return description.substring(0, DESCRIPTION_MAX_LENGTH - 3) + '...';
}

/**
 * 从建议源创建统一的SuggestionItem
 */
function createSuggestionFromSource(
  source: UnifiedSuggestionSource
): SuggestionItem {
  switch (source.type) {
    case 'file':
      return {
        id: `file-${source.path}`,
        displayText: source.displayText,
        description: source.description,
        metadata: { path: source.path, score: source.score },
      };
    case 'mcp_resource':
      return {
        id: `mcp-resource-${source.server}__${source.uri}`,
        displayText: source.displayText,
        description: source.description,
        metadata: { server: source.server, uri: source.uri },
      };
    case 'agent':
      return {
        id: `agent-${source.agentType}`,
        displayText: source.displayText,
        description: source.description,
        color: source.color,
        metadata: { agentType: source.agentType },
      };
    case 'command':
      return {
        id: `command-${source.commandName}`,
        displayText: source.displayText,
        description: source.description,
        metadata: {
          commandName: source.commandName,
          partKey: source.partKey,
          aliasKey: source.aliasKey,
        },
      };
  }
}

/**
 * 获取文件类型描述
 * @param filename 文件名
 * @returns 文件类型描述
 */
function getFileDescription(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const descriptions: Record<string, string> = {
    ts: 'TypeScript 文件',
    tsx: 'React TypeScript 文件',
    js: 'JavaScript 文件',
    jsx: 'React JavaScript 文件',
    json: '配置文件',
    md: 'Markdown 文档',
    html: 'HTML 文件',
    css: '样式文件',
    scss: 'SCSS 文件',
    vue: 'Vue 组件',
    py: 'Python 文件',
    go: 'Go 文件',
    rs: 'Rust 文件',
    yaml: 'YAML 配置',
    yml: 'YAML 配置',
    toml: 'TOML 配置',
    lock: '依赖锁定文件',
    env: '环境配置文件',
    gitignore: 'Git 忽略配置',
  };
  return descriptions[ext || ''] || '文件';
}

/**
 * 扫描目录获取文件列表
 * @param dir 目录路径
 * @param depth 递归深度
 * @returns 文件路径列表
 */
async function scanDirectory(
  dir: string,
  depth: number = 2
): Promise<string[]> {
  const results: string[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (depth > 0) {
          const nested = await scanDirectory(fullPath, depth - 1);
          results.push(...nested);
        }
      } else {
        results.push(fullPath);
      }
    }
  } catch (err) {
    // 忽略无法访问的目录

    logger.debug('Operation skipped', {
      context: '忽略无法访问的目录',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return results;
}

/**
 * 生成文件建议
 */
export async function generateFileSuggestions(
  query: string,
  showOnEmpty = false
): Promise<FileSuggestionSource[]> {
  if (!query && !showOnEmpty) {
    return [];
  }

  const suggestions: FileSuggestionSource[] = [];

  try {
    const cwd = process.cwd();
    const files = await scanDirectory(cwd, 2);

    const queryLower = query.toLowerCase();

    for (const fullPath of files) {
      const filename = fullPath.split(/[\\/]/).pop() || '';
      const relativePath = fullPath.startsWith(cwd)
        ? fullPath.slice(cwd.length + 1)
        : fullPath;

      if (
        !query ||
        filename.toLowerCase().includes(queryLower) ||
        relativePath.toLowerCase().includes(queryLower)
      ) {
        suggestions.push({
          type: 'file',
          displayText: './' + relativePath,
          description: getFileDescription(filename),
          path: './' + relativePath,
          filename,
          score: query ? 1.0 : undefined,
        });
      }

      if (suggestions.length >= MAX_UNIFIED_SUGGESTIONS) {
        break;
      }
    }
  } catch (err) {
    // 扫描失败时返回空列表

    logger.warn('Operation skipped', {
      context: '扫描失败时返回空列表',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return suggestions;
}

/**
 * 生成Agent建议
 */
export function generateAgentSuggestions(
  agents: AgentDefinition[],
  query: string,
  showOnEmpty = false
): AgentSuggestionSource[] {
  if (!query && !showOnEmpty) {
    return [];
  }

  const agentSources: AgentSuggestionSource[] = agents.map((agent) => ({
    type: 'agent',
    displayText: `${agent.agentType} (agent)`,
    description: truncateDescription(agent.whenToUse),
    agentType: agent.agentType,
    color: 'blue',
  }));

  if (!query) {
    return agentSources;
  }

  const queryLower = query.toLowerCase();
  return agentSources.filter(
    (source) =>
      source.displayText.toLowerCase().includes(queryLower) ||
      source.description.toLowerCase().includes(queryLower)
  );
}

/**
 * 生成MCP资源建议
 */
export function generateMcpResourceSuggestions(
  mcpResources: Record<string, ServerResource[]>,
  query: string,
  showOnEmpty = false
): McpResourceSuggestionSource[] {
  if (!query && !showOnEmpty) {
    return [];
  }

  const suggestions: McpResourceSuggestionSource[] = [];

  for (const [server, resources] of Object.entries(mcpResources)) {
    for (const resource of resources) {
      suggestions.push({
        type: 'mcp_resource',
        displayText: resource.name,
        description: truncateDescription(resource.description),
        server,
        uri: resource.uri,
        name: resource.name,
      });
    }
  }

  if (!query) {
    return suggestions.slice(0, MAX_UNIFIED_SUGGESTIONS);
  }

  const queryLower = query.toLowerCase();
  return suggestions
    .filter(
      (source) =>
        source.displayText.toLowerCase().includes(queryLower) ||
        source.description.toLowerCase().includes(queryLower)
    )
    .slice(0, MAX_UNIFIED_SUGGESTIONS);
}

/**
 * 生成命令建议
 */
export function generateCommandSuggestions(
  query: string,
  commands: Array<{ name: string; description?: string }>,
  showOnEmpty = false
): CommandSuggestionSource[] {
  if (!query && !showOnEmpty) {
    return [];
  }

  const commandSources: CommandSuggestionSource[] = commands.map((command) => ({
    type: 'command',
    displayText: `/${command.name}`,
    description: command.description
      ? truncateDescription(command.description)
      : undefined,
    commandName: command.name,
  }));

  if (!query) {
    return commandSources;
  }

  const queryLower = query.toLowerCase();
  return commandSources.filter(
    (source) =>
      source.displayText.toLowerCase().includes(queryLower) ||
      (source.description &&
        source.description.toLowerCase().includes(queryLower))
  );
}

/**
 * 生成统一建议
 * 整合文件、Agent、MCP资源、命令等多种建议源
 */
export async function generateUnifiedSuggestions(
  query: string,
  mcpResources: Record<string, ServerResource[]> = {},
  agents: AgentDefinition[] = [],
  commands: Array<{ name: string; description?: string }> = [],
  showOnEmpty = false
): Promise<SuggestionItem[]> {
  const sources: UnifiedSuggestionSource[] = [];

  const fileSuggestions = await generateFileSuggestions(query, showOnEmpty);
  sources.push(...fileSuggestions);

  const agentSuggestions = generateAgentSuggestions(agents, query, showOnEmpty);
  sources.push(...agentSuggestions);

  const mcpSuggestions = generateMcpResourceSuggestions(
    mcpResources,
    query,
    showOnEmpty
  );
  sources.push(...mcpSuggestions);

  const commandSuggestions = generateCommandSuggestions(
    query,
    commands,
    showOnEmpty
  );
  sources.push(...commandSuggestions);

  const items: SuggestionItem[] = sources
    .slice(0, MAX_UNIFIED_SUGGESTIONS)
    .map(createSuggestionFromSource);

  return items;
}
