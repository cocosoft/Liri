/**
 * MCP传输层基础类（重导出标准层实现）
 *
 * 标准层（唯一实现）：services/mcp/transports/MCPTransport.ts
 * 增强层（重导出）：mcp/transports/MCPTransport.ts
 *
 * 按照 §1.9 MCP模块架构规范和 §4.14 实现唯一性原则，
 * 抽象基类以标准层为唯一实现，增强层通过重导出引用。
 */

export { MCPTransport } from '../../services/mcp/transports/MCPTransport.js';
