/**
 * Unified Suggestions 统一建议生成模块
 * 基于CC源码设计
 */

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
 * 生成文件建议
 */
export function generateFileSuggestions(
  query: string,
  showOnEmpty = false
): FileSuggestionSource[] {
  if (!query && !showOnEmpty) {
    return [];
  }

  const suggestions: FileSuggestionSource[] = [];

  const mockFiles = [
    { path: './src/index.ts', filename: 'index.ts', description: '主入口文件' },
    { path: './src/types.ts', filename: 'types.ts', description: '类型定义' },
    {
      path: './package.json',
      filename: 'package.json',
      description: '项目配置',
    },
    { path: './README.md', filename: 'README.md', description: '项目文档' },
  ];

  const queryLower = query.toLowerCase();

  for (const file of mockFiles) {
    if (
      !query ||
      file.filename.toLowerCase().includes(queryLower) ||
      file.path.toLowerCase().includes(queryLower)
    ) {
      suggestions.push({
        type: 'file',
        displayText: file.path,
        description: file.description,
        path: file.path,
        filename: file.filename,
        score: query ? 1.0 : undefined,
      });
    }
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

  const fileSuggestions = generateFileSuggestions(query, showOnEmpty);
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
