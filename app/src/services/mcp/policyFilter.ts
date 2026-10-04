/**
 * MCP 企业策略过滤
 *
 * @deprecated 请使用 @modules/security/policy/MCPServerPolicy 替代
 * 此文件仅保留重导出以兼容存量代码
 */

export {
  filterMcpServersByPolicy,
  doesEnterpriseMcpConfigExist,
  excludeCommandsByServer,
  excludeResourcesByServer,
  type MCPServerPolicy,
} from '@modules/security';
