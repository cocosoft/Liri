/**
 * MCP官方注册表
 * 预置官方 modelcontextprotocol/servers 仓库的参考服务器，支持一键安装
 *
 * 对齐说明（2026-08-06）：
 * 官方仓库当前仅维护 7 个活跃参考服务器（Everything / Fetch / Filesystem /
 * Git / Memory / Sequential Thinking / Time），其余（GitHub、PostgreSQL、Slack、
 * Brave Search 等）均已归档至 servers-archived。本列表严格保持与官方仓库一致，
 * 仅含活跃服务器，安装命令与官方 README 完全一致。
 * */

import { getLogger } from '@modules/monitoring';
const logger = getLogger('services:mcp:officialRegistry');

interface RegistryServer {
  name: string;
  description: string;
  url?: string;
  command?: string;
  args?: string[];
  category: string;
  isOfficial: boolean;
}

const OFFICIAL_SERVERS: RegistryServer[] = [
  {
    name: 'everything',
    description: 'MCP 参考/测试服务器（prompts/resources/tools 全能力演示）',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything'],
    category: 'testing',
    isOfficial: true,
  },
  {
    name: 'fetch',
    description: '网页内容获取（Python，uvx 启动）',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    category: 'utility',
    isOfficial: true,
  },
  {
    name: 'filesystem',
    description: '文件系统访问',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    category: 'system',
    isOfficial: true,
  },
  {
    name: 'git',
    description: 'Git仓库操作（Python，uvx 启动）',
    command: 'uvx',
    args: ['mcp-server-git'],
    category: 'development',
    isOfficial: true,
  },
  {
    name: 'memory',
    description: '知识图谱记忆',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    category: 'ai',
    isOfficial: true,
  },
  {
    name: 'sequential-thinking',
    description: '思维链推理',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    category: 'ai',
    isOfficial: true,
  },
  {
    name: 'time',
    description: '时间与时区转换（Python，uvx 启动）',
    command: 'uvx',
    args: ['mcp-server-time'],
    category: 'system',
    isOfficial: true,
  },
];

let officialUrls: Set<string> | undefined;

function normalizeUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    u.search = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    // @ignore-catch — URL 规范化失败降级返回 undefined（非法 URL 不中断调用链）
    return undefined;
  }
}

export async function prefetchOfficialMcpUrls(): Promise<void> {
  try {
    const response = await fetch(
      'https://api.anthropic.com/mcp-registry/v0/servers?version=latest&visibility=commercial',
      { signal: AbortSignal.timeout(5000) }
    );

    if (!response.ok) {
      if (response.status === 403) {
        logger.debug(
          'MCP registry access restricted (403) — expected in sandbox/network-restricted environments'
        );
      } else {
        logger.warn(`Failed to fetch MCP registry: ${response.status}`);
      }
      return;
    }

    const data = (await response.json()) as {
      servers: Array<{ server: { remotes?: Array<{ url: string }> } }>;
    };
    const urls = new Set<string>();

    for (const entry of data.servers) {
      for (const remote of entry.server.remotes ?? []) {
        const normalized = normalizeUrl(remote.url);
        if (normalized) {
          urls.add(normalized);
        }
      }
    }

    officialUrls = urls;
    logger.info(`Loaded ${urls.size} official MCP URLs from registry`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'unknown error';
    logger.debug(`MCP registry prefetch unavailable: ${msg}`);
  }
}

export function isOfficialMcpUrl(normalizedUrl: string): boolean {
  return officialUrls?.has(normalizedUrl) ?? false;
}

export function getOfficialServers(): RegistryServer[] {
  return [...OFFICIAL_SERVERS];
}

export function getOfficialServersByCategory(
  category: string
): RegistryServer[] {
  return OFFICIAL_SERVERS.filter((s) => s.category === category);
}

export function getOfficialServer(name: string): RegistryServer | undefined {
  return OFFICIAL_SERVERS.find((s) => s.name === name);
}

export function getCategories(): string[] {
  const categories = new Set(OFFICIAL_SERVERS.map((s) => s.category));
  return Array.from(categories).sort();
}

export function resetOfficialUrlsForTesting(): void {
  officialUrls = undefined;
}

export const MCPOfficialRegistry = {
  prefetchOfficialMcpUrls,
  isOfficialMcpUrl,
  getOfficialServers,
  getOfficialServersByCategory,
  getOfficialServer,
  getCategories,
  resetOfficialUrlsForTesting,
};
