/**
 * MCP官方注册表
 * 预置常用MCP服务器配置，支持一键安装
 *
 * 基于CC源码 cc_code/backend/services/mcp/officialRegistry.ts 实现
 */

import { logger } from '../../utils/log';

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
    name: 'filesystem',
    description: '文件系统访问',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    category: 'system',
    isOfficial: true,
  },
  {
    name: 'github',
    description: 'GitHub API集成',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    category: 'development',
    isOfficial: true,
  },
  {
    name: 'git',
    description: 'Git仓库操作',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-git'],
    category: 'development',
    isOfficial: true,
  },
  {
    name: 'postgres',
    description: 'PostgreSQL数据库',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    category: 'database',
    isOfficial: true,
  },
  {
    name: 'sqlite',
    description: 'SQLite数据库',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite'],
    category: 'database',
    isOfficial: true,
  },
  {
    name: 'redis',
    description: 'Redis缓存',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-redis'],
    category: 'database',
    isOfficial: true,
  },
  {
    name: 'docker',
    description: 'Docker容器管理',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-docker'],
    category: 'infrastructure',
    isOfficial: true,
  },
  {
    name: 'kubernetes',
    description: 'Kubernetes集群管理',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-kubernetes'],
    category: 'infrastructure',
    isOfficial: true,
  },
  {
    name: 'sentry',
    description: 'Sentry错误追踪',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sentry'],
    category: 'monitoring',
    isOfficial: true,
  },
  {
    name: 'playwright',
    description: '浏览器自动化',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-playwright'],
    category: 'testing',
    isOfficial: true,
  },
  {
    name: 'puppeteer',
    description: '无头浏览器',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    category: 'testing',
    isOfficial: true,
  },
  {
    name: 'brave-search',
    description: 'Brave搜索',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    category: 'search',
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
    name: 'everart',
    description: 'AI图像生成',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everart'],
    category: 'creative',
    isOfficial: true,
  },
  {
    name: 'cloudflare',
    description: 'Cloudflare API',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-cloudflare'],
    category: 'infrastructure',
    isOfficial: true,
  },
  {
    name: 'linear',
    description: 'Linear项目管理',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-linear'],
    category: 'project-management',
    isOfficial: true,
  },
  {
    name: 'slack',
    description: 'Slack消息',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    category: 'communication',
    isOfficial: true,
  },
  {
    name: 'jira',
    description: 'Jira项目管理',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-jira'],
    category: 'project-management',
    isOfficial: true,
  },
  {
    name: 'fetch',
    description: '网页内容获取',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    category: 'utility',
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
    return undefined;
  }
}

export async function prefetchOfficialMcpUrls(): Promise<void> {
  try {
    const response = await fetch(
      'https://api.anthropic.com/mcp-registry/v0/servers?version=latest&visibility=commercial',
      { signal: AbortSignal.timeout(5000) },
    );

    if (!response.ok) {
      if (response.status === 403) {
        logger.debug('MCP registry access restricted (403) — expected in sandbox/network-restricted environments');
      } else {
        logger.warn(`Failed to fetch MCP registry: ${response.status}`);
      }
      return;
    }

    const data = await response.json() as { servers: Array<{ server: { remotes?: Array<{ url: string }> } }> };
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

export function getOfficialServersByCategory(category: string): RegistryServer[] {
  return OFFICIAL_SERVERS.filter(s => s.category === category);
}

export function getOfficialServer(name: string): RegistryServer | undefined {
  return OFFICIAL_SERVERS.find(s => s.name === name);
}

export function getCategories(): string[] {
  const categories = new Set(OFFICIAL_SERVERS.map(s => s.category));
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
