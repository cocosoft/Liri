/**
 * Bridge OAuth集成服务
 * 为Bridge模块提供OAuth认证支持
 */

import { logger } from '@modules/infrastructure';
import { mcpAuthManager } from '@modules/mcp';
import type { MCPOAuthConfig } from '@modules/mcp';

/**
 * Bridge会话OAuth配置
 */
export interface BridgeSessionOAuthConfig {
  sessionId: string;
  authServerUrl?: string;
  clientId?: string;
  scopes?: string[];
}

/**
 * Bridge OAuth集成管理器
 */
export class BridgeOAuthManager {
  private sessionTokens: Map<string, string> = new Map();

  /**
   * 为Bridge会话获取OAuth Token
   */
  async getSessionToken(sessionId: string, config: BridgeSessionOAuthConfig): Promise<string> {
    const cached = this.sessionTokens.get(sessionId);
    if (cached) {
      logger.debug(`Using cached OAuth token for session ${sessionId}`);
      return cached;
    }

    logger.info(`Obtaining OAuth token for bridge session ${sessionId}`);

    try {
      const mcpConfig = this.buildMCPConfig(config);
      const token = await mcpAuthManager.getAccessToken(sessionId, mcpConfig);
      
      this.sessionTokens.set(sessionId, token);
      logger.info(`OAuth token obtained for bridge session ${sessionId}`);
      
      return token;
    } catch (error) {
      logger.error(`Failed to obtain OAuth token for bridge session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * 撤销Bridge会话的OAuth Token
   */
  async revokeSessionToken(sessionId: string, config: BridgeSessionOAuthConfig): Promise<void> {
    this.sessionTokens.delete(sessionId);
    
    try {
      const mcpConfig = this.buildMCPConfig(config);
      await mcpAuthManager.revokeToken(sessionId, mcpConfig);
      logger.info(`OAuth token revoked for bridge session ${sessionId}`);
    } catch (error) {
      logger.warn(`Failed to revoke OAuth token for session ${sessionId}:`, error);
    }
  }

  /**
   * 清除所有Bridge会话的OAuth Token
   */
  clearAllSessionTokens(): void {
    this.sessionTokens.clear();
    logger.info('All bridge session OAuth tokens cleared');
  }

  /**
   * 构建MCP OAuth配置
   */
  private buildMCPConfig(config: BridgeSessionOAuthConfig): MCPOAuthConfig {
    return {
      clientId: config.clientId || process.env.PY_APP_OAUTH_CLIENT_ID || '',
      authUrl: config.authServerUrl || process.env.PY_APP_OAUTH_AUTH_URL || '',
      tokenUrl: config.authServerUrl ? `${config.authServerUrl}/oauth/token` : '',
      redirectUri: 'http://localhost:3000/callback',
      scopes: config.scopes || ['read', 'write'],
    };
  }

  /**
   * 获取活跃会话数
   */
  getActiveSessionCount(): number {
    return this.sessionTokens.size;
  }
}

export const bridgeOAuthManager = new BridgeOAuthManager();
