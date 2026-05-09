/**
 * MCP官方注册表
 * 负责从官方MCP注册表获取和缓存官方服务器URL列表
 * 基于CC源码 cc_code/backend/services/mcp/officialRegistry.ts 实现
 */

import { logger } from '@modules/utils/log';

interface RegistryServer {
  server?: {
    remotes?: Array<{ url: string }>;
  };
}

interface RegistryResponse {
  servers: RegistryServer[];
}

let officialUrls: Set<string> | undefined = undefined;

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
  if (process.env.PY_APP_DISABLE_NONESSENTIAL_TRAFFIC) {
    return;
  }

  try {
    const response = await fetch(
      'https://api.anthropic.com/mcp-registry/v0/servers?version=latest&visibility=commercial',
      { signal: AbortSignal.timeout(5000) }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as RegistryResponse;
    const urls = new Set<string>();

    for (const entry of data.servers) {
      for (const remote of entry.server?.remotes ?? []) {
        const normalized = normalizeUrl(remote.url);
        if (normalized) {
          urls.add(normalized);
        }
      }
    }

    officialUrls = urls;
    logger.debug(`[mcp-registry] Loaded ${urls.size} official MCP URLs`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.debug(`[mcp-registry] Prefetch unavailable: ${msg}`);
  }
}

export function isOfficialMcpUrl(normalizedUrl: string): boolean {
  return officialUrls?.has(normalizedUrl) ?? false;
}

export function resetOfficialMcpUrlsForTesting(): void {
  officialUrls = undefined;
}

export function getOfficialMcpUrlCount(): number {
  return officialUrls?.size ?? 0;
}

export function hasOfficialMcpUrls(): boolean {
  return officialUrls !== undefined && officialUrls.size > 0;
}
