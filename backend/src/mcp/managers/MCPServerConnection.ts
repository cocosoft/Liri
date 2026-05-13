/**
 * MCP服务器连接（重导出层）
 * 实际实现在 services/mcp/MCPConnection.ts
 * 类名 MCPConnection，以 MCPServerConnection 别名导出保持向后兼容
 */

export { MCPConnection as MCPServerConnection } from '@modules/services/mcp/MCPConnection.js';
