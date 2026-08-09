/**
 * Agent加载器
 * 负责从不同来源加载Agent定义
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import {
  AgentDefinition,
  AgentColorName,
  AgentMemoryScope,
  AgentSource,
} from '../models/types';
import type { HooksSettings } from '@modules/types';
import { parseFrontmatter } from '@modules/utils/frontmatterParser';
import { parseYAML, parseJSON, AgentDefinitionFile } from './agentDefinition';
import { Logger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { handleError } from '@modules/error/handleError';

const logger = new Logger({ module: 'agent:agentLoader' });

/**
 * 将新格式的Agent定义转换为内部格式
 */
function convertToAgentDefinition(
  fileDef: AgentDefinitionFile,
  filePath: string,
  source: string
): AgentDefinition {
  return {
    agentType: fileDef.type,
    whenToUse: fileDef.description,
    tools: fileDef.tools || [],
    disallowedTools: [],
    skills: [],
    mcpServers: [],
    hooks: {},
    color: undefined,
    model: fileDef.config.model,
    effort: undefined,
    permissionMode: undefined,
    maxTurns: undefined,
    filename: filePath,
    baseDir: join(filePath, '..'),
    criticalSystemReminder_EXPERIMENTAL: undefined,
    requiredMcpServers: [],
    background: undefined,
    initialPrompt: undefined,
    memory: fileDef.memory?.enabled ? fileDef.memory : undefined,
    isolation: undefined,
    omitClaudeMd: undefined,
    getSystemPrompt: () => '',
    source: source as unknown as Exclude<AgentSource, 'built-in' | 'plugin'>,
    name: fileDef.name,
    version: fileDef.version,
    config: {
      model: fileDef.config.model,
      temperature: fileDef.config.temperature,
      maxTokens: fileDef.config.maxTokens,
      timeout: fileDef.config.timeout,
    },
  };
}

/**
 * 从文件加载Agent定义（支持多种格式）
 * @param filePath 文件路径
 * @returns Agent定义
 */
function loadAgentFromFile(
  filePath: string,
  source: string = 'user'
): AgentDefinition {
  const content = readFileSync(filePath, 'utf8');

  // 尝试按扩展名解析
  if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
    const def = parseYAML(content);
    if (def) {
      return convertToAgentDefinition(def, filePath, source);
    }
  } else if (filePath.endsWith('.json')) {
    const def = parseJSON(content);
    if (def) {
      return convertToAgentDefinition(def, filePath, source);
    }
  } else if (filePath.endsWith('.md')) {
    const { frontmatter, content: body } = parseFrontmatter(content);
    const fm = frontmatter as Record<string, unknown>;
    return {
      agentType: (fm.agentType as string) || 'unknown',
      whenToUse: (fm.whenToUse as string) || '通用Agent',
      tools: (fm.tools as string[]) || [],
      disallowedTools: (fm.disallowedTools as string[]) || [],
      skills: (fm.skills as string[]) || [],
      mcpServers: (fm.mcpServers as string[]) || [],
      hooks: (fm.hooks as HooksSettings) || {},
      color: fm.color as AgentColorName | undefined,
      model: fm.model as string | undefined,
      effort: fm.effort as string | number | undefined,
      permissionMode: fm.permissionMode as string | undefined,
      maxTurns: fm.maxTurns as number | undefined,
      filename: filePath,
      baseDir: join(filePath, '..'),
      criticalSystemReminder_EXPERIMENTAL:
        fm.criticalSystemReminder_EXPERIMENTAL as string | undefined,
      requiredMcpServers: (fm.requiredMcpServers as string[]) || undefined,
      background: fm.background as boolean | undefined,
      initialPrompt: fm.initialPrompt as string | undefined,
      memory: fm.memory as
        | AgentMemoryScope
        | { enabled: boolean; retentionDays?: number }
        | undefined,
      isolation: fm.isolation as 'worktree' | 'remote' | undefined,
      omitClaudeMd: fm.omitClaudeMd as boolean | undefined,
      getSystemPrompt: () => body,
      source: source as unknown as Exclude<AgentSource, 'built-in' | 'plugin'>,
    };
  }

  throw new AppError(
    `Unsupported file format: ${filePath}`,
    ErrorCategory.EXECUTION,
    ErrorSeverity.HIGH,
    '1000'
  );
}

/**
 * 从目录加载Agent定义（支持多种格式）
 * @param dirPath 目录路径
 * @param source 来源标识
 * @returns Agent定义数组
 */
function loadAgentsFromDir(
  dirPath: string,
  source: string = 'user'
): AgentDefinition[] {
  if (!existsSync(dirPath)) {
    return [];
  }

  const agents: AgentDefinition[] = [];
  const files = readdirSync(dirPath);

  files.forEach((file) => {
    const filePath = join(dirPath, file);

    // 跳过目录
    try {
      const stats = statSync(filePath);
      if (stats.isDirectory()) {
        return;
      }
    } catch {
      return;
    }

    // 支持的文件格式
    if (
      file.endsWith('.md') ||
      file.endsWith('.yaml') ||
      file.endsWith('.yml') ||
      file.endsWith('.json')
    ) {
      try {
        const agent = loadAgentFromFile(filePath, source);
        agents.push(agent);
      } catch (error) {
        handleError(error, { module: 'agent:loader', action: '加载Agent文件' });
      }
    }
  });

  return agents;
}

/**
 * 统一加载Agent定义入口
 * 从指定目录加载Agent定义，支持 .md / .yaml / .yml / .json 格式
 * @param dirPath 目录路径
 * @param source 来源标识
 * @returns Agent定义数组
 */
export function loadAgentsDir(
  dirPath: string,
  source: string = 'user'
): AgentDefinition[] {
  return loadAgentsFromDir(dirPath, source);
}

/**
 * 加载用户级Agent
 * @returns Agent定义数组
 */
export async function loadUserAgents(): Promise<AgentDefinition[]> {
  const userAgentsDir = join(resolvePyappHome(), 'agents');
  return loadAgentsFromDir(userAgentsDir);
}

import { resolveDataSubDir, resolvePyappHome } from '@modules/core';

/**
 * 加载项目级Agent
 * @returns Agent定义数组
 */
export async function loadProjectAgents(): Promise<AgentDefinition[]> {
  const projectAgentsDir = resolveDataSubDir('agents');
  return loadAgentsFromDir(projectAgentsDir);
}

/**
 * 加载管理级Agent
 * @returns Agent定义数组
 */
export async function loadManagedAgents(): Promise<AgentDefinition[]> {
  const managedAgentsDir = resolveDataSubDir(join('agents', 'managed'));
  return loadAgentsFromDir(managedAgentsDir);
}

/**
 * 加载本地Agent
 * @returns Agent定义数组
 */
export async function loadLocalAgents(): Promise<AgentDefinition[]> {
  const localAgentsDir = resolveDataSubDir(join('agents', 'local'));
  return loadAgentsFromDir(localAgentsDir);
}
