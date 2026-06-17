/**
 * MCP OAuth认证模块统一入口
 * @deprecated 请从 @modules/services/mcp/auth 导入
 */

export {
  MCPAuthManager,
  mcpAuthManager,
} from '../../services/mcp/auth/MCPAuth.js';
export {
  MCPOAuthProvider,
  createMCPOAuthProvider,
} from '../../services/mcp/auth/MCPOAuthProvider.js';
export type {
  MCPOAuthConfig,
  MCPOAuthToken,
  MCPOAuthState,
  MCPOAuthDiscoveryState,
} from '../../services/mcp/auth/types.js';
