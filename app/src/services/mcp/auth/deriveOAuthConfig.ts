// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 从 `MCPServerConfig` 派生 `MCPOAuthConfig`（**单一实现**）。
 *
 * 沿革：原为 `mcp/cli/mcpCommand.ts` 内的私有函数；`mcp_auth` 工具接线（Q-18，2026-10-23）
 * 需要同一口径 ⇒ 抽到服务层共享，避免两处推导漂移（CS01）。
 *
 * 口径：服务器必须声明 `oauth.clientId`；元数据源取 `oauth.authServerMetadataUrl`，缺省回退
 * 服务器 `url`；授权/令牌端点按该源的 **origin** 推导，回调地址指向本地服务端口。
 */
import {
  DEFAULT_MCP_OAUTH_CALLBACK_PORT,
  LOCAL_SERVICE_HOST,
} from '@modules/core';
import type { MCPServerConfig } from '../types/index.js';
import type { MCPOAuthConfig } from './types.js';

/** 无法派生（缺 clientId / 无 URL / URL 非法）⇒ `null`（调用方按"未配置 OAuth"处理） */
export function deriveOAuthConfig(
  config: MCPServerConfig
): MCPOAuthConfig | null {
  if (!config.oauth?.clientId) return null;

  const metadataUrl = config.oauth.authServerMetadataUrl || config.url;
  if (!metadataUrl) return null;

  try {
    const origin = new URL(metadataUrl).origin;
    return {
      clientId: config.oauth.clientId,
      authUrl: `${origin}/authorize`,
      tokenUrl: `${origin}/token`,
      redirectUri: `http://${LOCAL_SERVICE_HOST}:${config.oauth.callbackPort || DEFAULT_MCP_OAUTH_CALLBACK_PORT}/callback`,
    };
  } catch {
    // @ignore-catch — URL 非法 ⇒ 视为未配置 OAuth（不抛出，交由调用方如实上报）
    return null;
  }
}
