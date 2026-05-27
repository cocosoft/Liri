/**
 * MCP名称规范化工具
 * 重导出标准层 normalization，保持API兼容
 */
export {
  normalizeNameForMCP,
  needsNormalization,
  normalizeSimpleToolName,
  normalizeSimpleResourceUri,
  normalizeToolName,
  normalizeCommandName,
  normalizeResourceUri,
  denormalizeMcpName,
  isValidMcpName,
} from '../../services/mcp/normalization.js';
