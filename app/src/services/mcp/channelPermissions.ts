/**
 * 通道权限管理
 *
 * @deprecated 请使用 @modules/security/policy/ChannelPermission 替代
 * 此文件仅保留重导出以兼容存量代码
 */

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
} from '../../security/policy/ChannelPermission';
export type {
  PermissionBehavior,
  ResourcePermission,
  ToolPermission,
  ChannelPermissionConfig,
  ChannelPermissionResponse,
  ChannelPermissionCallbacks,
  DefaultChannelPermissionCallbacks,
} from '../../security/policy/ChannelPermission';
