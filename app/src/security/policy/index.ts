/**
 * 安全策略模块
 *
 * 聚合 MCP 服务器策略 + 通道权限管理
 */

export {
  filterMcpServersByPolicy,
  doesEnterpriseMcpConfigExist,
  excludeCommandsByServer,
  excludeResourcesByServer,
} from './MCPServerPolicy';
export type { MCPServerPolicy } from './MCPServerPolicy';

export {
  ChannelPermissionRelay,
  getChannelPermissionRelay,
  clearChannelPermissionRelay,
  createChannelPermissionCallbacks,
  isChannelPermissionRelayEnabled,
  sendChannelPermissionRequest,
  setChannelPermissionConfig,
  getChannelPermissionConfig,
  removeChannelPermissionConfig,
  checkResourcePermission,
  checkToolPermission,
  isResourceAccessAllowed,
  isToolAccessAllowed,
  channelPermissions,
} from './ChannelPermission';
export type {
  PermissionBehavior,
  ResourcePermission,
  ToolPermission,
  ChannelPermissionConfig,
  ChannelPermissionResponse,
  ChannelPermissionCallbacks,
  DefaultChannelPermissionCallbacks,
} from './ChannelPermission';
