/**
 * Agent内存管理
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolveDataDir } from '@modules/core';
import { getProjectRoot } from '../../bootstrap/state.js';
import { getConfigHomeDir } from '@modules/utils/envUtils';
import { getCwd } from '@modules/utils/cwd';

import { configManager } from '@modules/config';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'services:agent:agentMemory',
  level: LogLevel.INFO,
});

/**
 * 查找规范的Git根目录
 */
function findCanonicalGitRoot(dir: string): string | null {
  try {
    let currentDir = dir;
    while (currentDir !== path.dirname(currentDir)) {
      if (fs.existsSync(path.join(currentDir, '.git'))) {
        return currentDir;
      }
      currentDir = path.dirname(currentDir);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 确保内存目录存在
 */
function ensureMemoryDirExists(dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 获取内存基础目录
 */
function getMemoryBaseDir(): string {
  return getConfigHomeDir();
}

/**
 * 构建内存提示
 */
function buildMemoryPrompt(options: {
  displayName: string;
  memoryDir: string;
  extraGuidelines?: string[];
}): string {
  const { displayName, memoryDir, extraGuidelines = [] } = options;

  let prompt = `# ${displayName}\n\n`;
  prompt += `This agent has access to persistent memory stored at: ${memoryDir}\n\n`;
  prompt += `## Memory Guidelines\n`;
  prompt += `- Store factual information, patterns, and insights that will be useful for future tasks\n`;
  prompt += `- Avoid storing transient or context-specific information\n`;
  prompt += `- Organize information in a clear, structured format\n`;

  if (extraGuidelines.length > 0) {
    prompt += `\n## Additional Guidelines\n`;
    extraGuidelines.forEach((guideline) => {
      prompt += `${guideline}\n`;
    });
  }

  return prompt;
}

/**
 * Agent内存范围
 */
export type AgentMemoryScope = 'user' | 'project' | 'local';

/**
 * 清理Agent类型名称，用于目录名
 * 将冒号（Windows上无效，用于插件命名空间的Agent类型如 "my-plugin:my-agent"）替换为破折号
 */
function sanitizeAgentTypeForPath(agentType: string): string {
  return agentType.replace(/:/g, '-');
}

/**
 * 返回本地Agent内存目录，特定于项目且不签入VCS
 */
function getLocalAgentMemoryDir(dirName: string): string {
  const remoteMemoryDir = configManager.env('Liri_REMOTE_MEMORY_DIR');
  if (remoteMemoryDir) {
    return (
      path.join(
        remoteMemoryDir,
        'projects',
        findCanonicalGitRoot(getProjectRoot()) ?? getProjectRoot(),
        'agent-memory-local',
        dirName
      ) + path.sep
    );
  }
  return path.join(resolveDataDir(), 'agent-memory-local', dirName) + path.sep;
}

/**
 * 返回给定Agent类型和范围的Agent内存目录
 */
export function getAgentMemoryDir(
  agentType: string,
  scope: AgentMemoryScope
): string {
  const dirName = sanitizeAgentTypeForPath(agentType);
  switch (scope) {
    case 'project':
      return path.join(resolveDataDir(), 'agent-memory', dirName) + path.sep;
    case 'local':
      return getLocalAgentMemoryDir(dirName);
    case 'user':
      return path.join(getMemoryBaseDir(), 'agent-memory', dirName) + path.sep;
  }
}

/**
 * 检查文件是否在Agent内存目录中（任何范围）
 */
export function isAgentMemoryPath(absolutePath: string): boolean {
  const normalizedPath = path.normalize(absolutePath);
  const memoryBase = getMemoryBaseDir();

  // 用户范围：检查内存基础目录
  if (
    normalizedPath.startsWith(path.join(memoryBase, 'agent-memory') + path.sep)
  ) {
    return true;
  }

  // 项目范围：基于当前工作目录
  if (
    normalizedPath.startsWith(
      path.join(resolveDataDir(), 'agent-memory') + path.sep
    )
  ) {
    return true;
  }

  // 本地范围：根据环境变量决定
  const remoteMemoryDir = configManager.env('Liri_REMOTE_MEMORY_DIR');
  if (remoteMemoryDir) {
    if (
      normalizedPath.includes(path.sep + 'agent-memory-local' + path.sep) &&
      normalizedPath.startsWith(
        path.join(remoteMemoryDir, 'projects') + path.sep
      )
    ) {
      return true;
    }
  } else if (
    normalizedPath.startsWith(
      path.join(resolveDataDir(), 'agent-memory-local') + path.sep
    )
  ) {
    return true;
  }

  return false;
}

/**
 * 返回给定Agent类型和范围的Agent内存文件路径
 */
export function getAgentMemoryEntrypoint(
  agentType: string,
  scope: AgentMemoryScope
): string {
  return path.join(getAgentMemoryDir(agentType, scope), 'MEMORY.md');
}

/**
 * 获取内存范围的显示名称
 */
export function getMemoryScopeDisplay(
  memory: AgentMemoryScope | undefined
): string {
  switch (memory) {
    case 'user':
      return `User (${path.join(getMemoryBaseDir(), 'agent-memory')}/)`;
    case 'project':
      return 'Project (agent-memory/)';
    case 'local':
      return `Local (${getLocalAgentMemoryDir('...')})`;
    default:
      return 'None';
  }
}

/**
 * 为启用了内存的Agent加载持久内存
 * 必要时创建内存目录并返回包含内存内容的提示
 */
export function loadAgentMemoryPrompt(
  agentType: string,
  scope: AgentMemoryScope
): string {
  let scopeNote: string;
  switch (scope) {
    case 'user':
      scopeNote =
        '- Since this memory is user-scope, keep learnings general since they apply across all projects';
      break;
    case 'project':
      scopeNote =
        '- Since this memory is project-scope and shared with your team via version control, tailor your memories to this project';
      break;
    case 'local':
      scopeNote =
        '- Since this memory is local-scope (not checked into version control), tailor your memories to this project and machine';
      break;
  }

  const memoryDir = getAgentMemoryDir(agentType, scope);

  // 异步创建目录（非阻塞）
  void ensureMemoryDirExists(memoryDir);

  const extraGuidelines = configManager.env('Liri_MEMORY_EXTRA_GUIDELINES');
  return buildMemoryPrompt({
    displayName: 'Persistent Agent Memory',
    memoryDir,
    extraGuidelines:
      extraGuidelines && extraGuidelines.trim().length > 0
        ? [scopeNote, extraGuidelines]
        : [scopeNote],
  });
}
