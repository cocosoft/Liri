/**
 * Agent加载器
 * 负责从不同来源加载Agent定义
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { AgentDefinition } from '../models/types';
import { parseFrontmatter } from '@modules/utils/frontmatterParser';
import { parseYAML, parseJSON, AgentDefinitionFile } from './agentDefinition';
import { Logger } from '@modules/monitoring/logs/Logger';

const logger = new Logger();

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
    source: source as any,
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
    return {
      agentType: frontmatter.agentType || 'unknown',
      whenToUse: frontmatter.whenToUse || '通用Agent',
      tools: frontmatter.tools || [],
      disallowedTools: frontmatter.disallowedTools || [],
      skills: frontmatter.skills || [],
      mcpServers: frontmatter.mcpServers || [],
      hooks: frontmatter.hooks || {},
      color: frontmatter.color,
      model: frontmatter.model,
      effort: frontmatter.effort,
      permissionMode: frontmatter.permissionMode,
      maxTurns: frontmatter.maxTurns,
      filename: filePath,
      baseDir: join(filePath, '..'),
      criticalSystemReminder_EXPERIMENTAL:
        frontmatter.criticalSystemReminder_EXPERIMENTAL,
      requiredMcpServers: frontmatter.requiredMcpServers,
      background: frontmatter.background,
      initialPrompt: frontmatter.initialPrompt,
      memory: frontmatter.memory,
      isolation: frontmatter.isolation,
      omitClaudeMd: frontmatter.omitClaudeMd,
      getSystemPrompt: () => body,
      source: source as any,
    };
  }

  throw new Error(`Unsupported file format: ${filePath}`);
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
        logger.error('加载Agent文件失败', {
          filePath,
          error: error instanceof Error ? error.message : String(error),
        });
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
  const userAgentsDir = join(
    process.env.HOME || process.env.USERPROFILE || '',
    '.py_app',
    'agents'
  );
  return loadAgentsFromDir(userAgentsDir);
}

/**
 * 加载项目级Agent
 * @returns Agent定义数组
 */
export async function loadProjectAgents(): Promise<AgentDefinition[]> {
  const projectAgentsDir = join(process.cwd(), '.py_app', 'agents');
  return loadAgentsFromDir(projectAgentsDir);
}

/**
 * 加载管理级Agent
 * @returns Agent定义数组
 */
export async function loadManagedAgents(): Promise<AgentDefinition[]> {
  const managedAgentsDir = join(
    __dirname,
    '..',
    '..',
    '..',
    'agents',
    'managed'
  );
  return loadAgentsFromDir(managedAgentsDir);
}

/**
 * 加载本地Agent
 * @returns Agent定义数组
 */
export async function loadLocalAgents(): Promise<AgentDefinition[]> {
  const localAgentsDir = join(__dirname, '..', '..', '..', 'agents', 'local');
  return loadAgentsFromDir(localAgentsDir);
}
