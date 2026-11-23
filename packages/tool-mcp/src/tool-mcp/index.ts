/**
 * `@openliri/tool-mcp` 包出口（I 档，2026-11-23）
 *
 * 域：MCP（资源/提示面 + OAuth 授权闸）。
 * - 根出口：app 注册表与测试所需符号；
 * - 深层子路径（`@openliri/tool-mcp/MCPResourceTool/*`）由 `package.json#exports["./*"]`
 *   与 `app/tsconfig.json` paths 支持。
 */

export { MCPResourceTool } from './MCPResourceTool/MCPResourceTool';
export type {
  MCPResourceToolInput,
  MCPResourceToolOutput,
} from './MCPResourceTool/MCPResourceTool';
export {
  MCPResourceInputSchema,
  MCPResourceOutputSchema,
  validateMCPResourceInput,
} from './MCPResourceTool/schemas';
export type {
  MCPResourceInput,
  MCPResourceOutput,
} from './MCPResourceTool/schemas';

export { McpAuthTool, createMcpAuthTool } from './McpAuthTool/McpAuthTool';
export type {
  McpAuthManagerLike,
  McpAuthParams,
  McpAuthServerStatus,
  McpServerManagerLike,
} from './McpAuthTool/McpAuthTool';
