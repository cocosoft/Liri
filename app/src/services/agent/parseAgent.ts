//
/**
 * Agent解析工具
 */

import * as path from 'path';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });
import { CustomAgentDefinition, SettingSource } from './types';
import {
  parseAgentToolsFromFrontmatter,
  parseSlashCommandToolsFromFrontmatter,
} from '@modules/utils/markdownConfigLoader';
import { parsePositiveIntFromFrontmatter } from '@modules/utils/frontmatterParser';
import { EFFORT_LEVELS, parseEffortValue } from '@modules/utils/effort';
import { PermissionMode } from '@modules/permission/PermissionMode';
import { configManager } from '@modules/config';
import { AgentMcpServerSpec } from './agentMcpServer';
import { loadAgentMemoryPrompt } from './agentMemory';

type NonPluginSource = Exclude<SettingSource, 'built-in' | 'plugin'>;

/**
 * 工具名称常量
 */
const FILE_EDIT_TOOL_NAME = 'file_edit';
const FILE_READ_TOOL_NAME = 'file_read';
const FILE_WRITE_TOOL_NAME = 'file_write';

/**
 * 权限模式列表
 */
export const PERMISSION_MODES = [
  'default',
  'auto',
  'acceptEdits',
  'dontAsk',
  'plan',
] as const;

/**
 * 检查是否启用自动内存
 */
function isAutoMemoryEnabled(): boolean {
  return true;
}

/**
 * 从Markdown文件解析Agent定义
 */
export function parseAgentFromMarkdown(
  filePath: string,
  baseDir: string,
  frontmatter: Record<string, unknown>,
  content: string,
  source: NonPluginSource
): CustomAgentDefinition | null {
  try {
    const agentType = frontmatter['name'];
    let whenToUse = frontmatter['description'] as string;

    // 验证必需字段
    if (!agentType || typeof agentType !== 'string') {
      return null;
    }
    if (!whenToUse || typeof whenToUse !== 'string') {
      logger.debug(
        `Agent file ${filePath} is missing required 'description' in frontmatter`
      );
      return null;
    }

    // 处理whenToUse中的转义换行符
    whenToUse = whenToUse.replace(/\\n/g, '\n');

    const color = frontmatter['color'] as string | undefined;
    const modelRaw = frontmatter['model'];
    let model: string | undefined;
    if (typeof modelRaw === 'string' && modelRaw.trim().length > 0) {
      const trimmed = modelRaw.trim();
      model = trimmed.toLowerCase() === 'inherit' ? 'inherit' : trimmed;
    }

    // 解析background标志
    const backgroundRaw = frontmatter['background'];
    if (
      backgroundRaw !== undefined &&
      backgroundRaw !== 'true' &&
      backgroundRaw !== 'false' &&
      backgroundRaw !== true &&
      backgroundRaw !== false
    ) {
      logger.debug(
        `Agent file ${filePath} has invalid background value '${backgroundRaw}'. Must be 'true', 'false', or omitted.`
      );
    }

    const background =
      backgroundRaw === 'true' || backgroundRaw === true ? true : undefined;

    // 解析内存范围
    const VALID_MEMORY_SCOPES = ['user', 'project', 'local'] as const;
    const memoryRaw = frontmatter['memory'] as string | undefined;
    let memory: 'user' | 'project' | 'local' | undefined;
    if (memoryRaw !== undefined) {
      if (VALID_MEMORY_SCOPES.includes(memoryRaw as any)) {
        memory = memoryRaw as 'user' | 'project' | 'local';
      } else {
        logger.debug(
          `Agent file ${filePath} has invalid memory value '${memoryRaw}'. Valid options: ${VALID_MEMORY_SCOPES.join(', ')}`
        );
      }
    }

    // 解析isolation模式
    type IsolationMode = 'worktree' | 'remote';
    const VALID_ISOLATION_MODES: IsolationMode[] = ['worktree'];
    if (configManager.env('USER_TYPE') === 'ant') {
      VALID_ISOLATION_MODES.push('remote');
    }
    const isolationRaw = frontmatter['isolation'] as string | undefined;
    let isolation: IsolationMode | undefined;
    if (isolationRaw !== undefined) {
      if (VALID_ISOLATION_MODES.includes(isolationRaw as IsolationMode)) {
        isolation = isolationRaw as IsolationMode;
      } else {
        logger.debug(
          `Agent file ${filePath} has invalid isolation value '${isolationRaw}'. Valid options: ${VALID_ISOLATION_MODES.join(', ')}`
        );
      }
    }

    // 解析effort
    const effortRaw = frontmatter['effort'];
    const parsedEffort =
      effortRaw !== undefined ? parseEffortValue(effortRaw) : undefined;

    if (effortRaw !== undefined && parsedEffort === undefined) {
      logger.debug(
        `Agent file ${filePath} has invalid effort '${effortRaw}'. Valid options: ${EFFORT_LEVELS.join(', ')} or an integer`
      );
    }

    // 解析permissionMode
    const permissionModeRaw = frontmatter['permissionMode'] as
      | string
      | undefined;
    const isValidPermissionMode =
      permissionModeRaw &&
      (PERMISSION_MODES as readonly string[]).includes(permissionModeRaw);

    if (permissionModeRaw && !isValidPermissionMode) {
      logger.debug(
        `Agent file ${filePath} has invalid permissionMode '${permissionModeRaw}'. Valid options: ${PERMISSION_MODES.join(', ')}`
      );
    }

    // 解析maxTurns
    const maxTurnsRaw = frontmatter['maxTurns'];
    const maxTurns = parsePositiveIntFromFrontmatter(maxTurnsRaw);
    if (maxTurnsRaw !== undefined && maxTurns === undefined) {
      logger.debug(
        `Agent file ${filePath} has invalid maxTurns '${maxTurnsRaw}'. Must be a positive integer.`
      );
    }

    // 提取文件名（不含扩展名）
    const filename = path.basename(filePath, '.md');

    // 解析tools
    let tools = parseAgentToolsFromFrontmatter(frontmatter['tools']);

    // 如果启用了内存，注入Write/Edit/Read工具
    if (isAutoMemoryEnabled() && memory && tools !== undefined) {
      const toolSet = new Set(tools);
      for (const tool of [
        FILE_WRITE_TOOL_NAME,
        FILE_EDIT_TOOL_NAME,
        FILE_READ_TOOL_NAME,
      ]) {
        if (!toolSet.has(tool)) {
          tools = [...tools, tool];
        }
      }
    }

    // 解析disallowedTools
    const disallowedToolsRaw = frontmatter['disallowedTools'];
    const disallowedTools =
      disallowedToolsRaw !== undefined
        ? parseAgentToolsFromFrontmatter(disallowedToolsRaw)
        : undefined;

    // 解析skills
    const skills = parseSlashCommandToolsFromFrontmatter(frontmatter['skills']);

    // 解析initialPrompt
    const initialPromptRaw = frontmatter['initialPrompt'];
    const initialPrompt =
      typeof initialPromptRaw === 'string' && initialPromptRaw.trim()
        ? initialPromptRaw
        : undefined;

    // 解析mcpServers
    const mcpServersRaw = frontmatter['mcpServers'];
    let mcpServers: AgentMcpServerSpec[] | undefined;
    if (Array.isArray(mcpServersRaw)) {
      mcpServers = mcpServersRaw
        .map((item) => {
          // 简单验证：字符串或对象
          if (
            typeof item === 'string' ||
            (typeof item === 'object' && item !== null)
          ) {
            return item as AgentMcpServerSpec;
          }
          logger.debug(`Invalid mcpServers item in ${filePath}`);
          return null;
        })
        .filter((item): item is AgentMcpServerSpec => item !== null);
    }

    const systemPrompt = content.trim();
    const agentDef: CustomAgentDefinition = {
      baseDir,
      agentType: agentType,
      whenToUse: whenToUse,
      ...(tools !== undefined ? { tools } : {}),
      ...(disallowedTools !== undefined ? { disallowedTools } : {}),
      ...(skills !== undefined ? { skills } : {}),
      ...(initialPrompt !== undefined ? { initialPrompt } : {}),
      ...(mcpServers !== undefined && mcpServers.length > 0
        ? { mcpServers }
        : {}),
      getSystemPrompt: () => {
        if (isAutoMemoryEnabled() && memory) {
          const memoryPrompt = loadAgentMemoryPrompt(agentType, memory);
          return systemPrompt + '\n\n' + memoryPrompt;
        }
        return systemPrompt;
      },
      source,
      filename,
      ...(color ? { color: color as any } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(parsedEffort !== undefined ? { effort: parsedEffort } : {}),
      ...(isValidPermissionMode
        ? { permissionMode: permissionModeRaw as PermissionMode }
        : {}),
      ...(maxTurns !== undefined ? { maxTurns } : {}),
      ...(background ? { background } : {}),
      ...(memory ? { memory } : {}),
      ...(isolation ? { isolation } : {}),
    };

    return agentDef;
  } catch (error) {
    logger.error(`Error parsing agent from ${filePath}:`, error as Error);
    return null;
  }
}

/**
 * 从JSON解析Agent定义
 */
export function parseAgentFromJson(
  name: string,
  definition: any,
  source: NonPluginSource = 'flagSettings'
): CustomAgentDefinition | null {
  try {
    const {
      description,
      tools,
      disallowedTools,
      prompt,
      model,
      effort,
      permissionMode,
      mcpServers,
      hooks,
      maxTurns,
      skills,
      initialPrompt,
      background,
      memory,
      isolation,
    } = definition;

    // 验证必需字段
    if (!description || typeof description !== 'string') {
      logger.debug(`Agent '${name}' is missing required 'description'`);
      return null;
    }
    if (!prompt || typeof prompt !== 'string') {
      logger.debug(`Agent '${name}' is missing required 'prompt'`);
      return null;
    }

    let parsedTools = parseAgentToolsFromFrontmatter(tools);

    // 如果启用了内存，注入Write/Edit/Read工具
    if (isAutoMemoryEnabled() && memory && parsedTools !== undefined) {
      const toolSet = new Set(parsedTools);
      for (const tool of [
        FILE_WRITE_TOOL_NAME,
        FILE_EDIT_TOOL_NAME,
        FILE_READ_TOOL_NAME,
      ]) {
        if (!toolSet.has(tool)) {
          parsedTools = [...parsedTools, tool];
        }
      }
    }

    const parsedDisallowedTools =
      disallowedTools !== undefined
        ? parseAgentToolsFromFrontmatter(disallowedTools)
        : undefined;

    const systemPrompt = prompt;

    const agent: CustomAgentDefinition = {
      agentType: name,
      whenToUse: description,
      ...(parsedTools !== undefined ? { tools: parsedTools } : {}),
      ...(parsedDisallowedTools !== undefined
        ? { disallowedTools: parsedDisallowedTools }
        : {}),
      getSystemPrompt: () => {
        if (isAutoMemoryEnabled() && memory) {
          return systemPrompt + '\n\n' + loadAgentMemoryPrompt(name, memory);
        }
        return systemPrompt;
      },
      source,
      ...(model ? { model } : {}),
      ...(effort !== undefined ? { effort } : {}),
      ...(permissionMode ? { permissionMode } : {}),
      ...(mcpServers && mcpServers.length > 0 ? { mcpServers } : {}),
      ...(hooks ? { hooks } : {}),
      ...(maxTurns !== undefined ? { maxTurns } : {}),
      ...(skills && skills.length > 0 ? { skills } : {}),
      ...(initialPrompt ? { initialPrompt } : {}),
      ...(background ? { background } : {}),
      ...(memory ? { memory } : {}),
      ...(isolation ? { isolation } : {}),
    };

    return agent;
  } catch (error) {
    logger.error(`Error parsing agent '${name}' from JSON:`, error as Error);
    return null;
  }
}

/**
 * 从JSON对象解析多个Agent定义
 */
export function parseAgentsFromJson(
  agentsJson: any,
  source: NonPluginSource = 'flagSettings'
): CustomAgentDefinition[] {
  try {
    if (typeof agentsJson !== 'object' || agentsJson === null) {
      logger.debug('Invalid agents JSON: not an object');
      return [];
    }

    return Object.entries(agentsJson)
      .map(([name, def]) => parseAgentFromJson(name, def, source))
      .filter((agent): agent is CustomAgentDefinition => agent !== null);
  } catch (error) {
    logger.error('Error parsing agents from JSON:', error as Error);
    return [];
  }
}
