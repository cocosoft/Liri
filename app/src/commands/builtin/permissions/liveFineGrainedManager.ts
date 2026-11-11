/**
 * 命令层：取细粒度 RBAC 管理器（`roles/users/resources/rules` 四份 JSON）
 *
 * 与 `livePermissionManager()` 的区别：
 * - 后者是**工具判定**用的 `PermissionManager`（规则落 `tool_rules.json`）；
 * - 本函数返回的存储服务于 **角色 / 用户 / 资源** 绑定（`rules.json`），
 *   由 `PermissionManager.checkFineGrainedDeny` 在工具判定时读取 deny 规则。
 *
 * 单独成模块是给命令测试提供替换点（与 `livePermissionManager` 同一做法）。
 */
import {
  createFineGrainedPermissionManager,
  type FineGrainedPermissionManager,
} from '@openliri/infra/permission';

export function liveFineGrainedManager(): FineGrainedPermissionManager {
  return createFineGrainedPermissionManager();
}
