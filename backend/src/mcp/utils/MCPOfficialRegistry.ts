/**
 * MCP官方注册表（增强层）
 * 标准实现委托到 services/mcp/MCPOfficialRegistry
 * 增强层维护预置的官方服务器列表（一键安装）
 */

export {
  prefetchOfficialMcpUrls,
  isOfficialMcpUrl,
  getOfficialServers,
  getOfficialServersByCategory,
  getOfficialServer,
  getCategories,
} from '../../services/mcp/MCPOfficialRegistry';
