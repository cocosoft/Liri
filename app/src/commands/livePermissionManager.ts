/**
 * 命令层：取「运行时真正生效」的权限管理器（ChatManager 持有、工具执行链路共用的那一个实例）。
 *
 * 2026-11-11：`/permissions mode` 与 `/chat` 都必须用**同一个** `PermissionManager`，
 * 否则命令写进去的模式与工具判定读到的实例不是同一个（旧实现里 `/permissions mode`
 * 写影子存储、`/chat` 自建执行器，两条都不生效或互不可见）。
 *
 * 判定链证据：
 * - ChatManager 把实例存在 `permissionManager` 字段（`getPermissionManager()`）；
 * - 主聊天工具执行经 `facadeWiring: getPermissionManager: () => host.permissionManager`
 *   读同一字段；
 * - `/chat` 命令把本函数返回的实例交给 `ToolExecutor`，与主链同源。
 *
 * 首个对话前 `llmChatOps` 尚未装配（字段为 `undefined`）⇒ 这里**补装配**；
 * `llmChatOps` 已改为"仅缺失才装配"，不会再把这里创建的实例覆盖掉。
 */
import {
  createPermissionManager,
  type PermissionManager,
} from '@openliri/infra/permission';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import { getLogger } from '@openliri/infra/monitoring';

const logger = getLogger('commands:livePermissionManager');

export function livePermissionManager(): PermissionManager | undefined {
  try {
    const chatManager = getCoreAPI().getChatManager();
    const existing = chatManager.getPermissionManager() as
      | PermissionManager
      | undefined;
    if (existing) return existing;

    const created = createPermissionManager();
    chatManager.setPermissionManager(created);
    return created;
  } catch (error) {
    // 组合根未装配（测试环境 / 启动早期）⇒ 视为不可用；调用方负责明确告知用户，
    // 不静默假装设置成功。
    logger.debug('权限管理器不可用（组合根未装配）', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
