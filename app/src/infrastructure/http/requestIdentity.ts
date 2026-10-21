/**
 * requestIdentity — HTTP 请求 → `Principal` 解析（多租户 P0 · 阶段 2）
 *
 * 口径（**保持既有鉴权语义不变**，只补身份解析）：
 *   - 无 `Authorization: Bearer` ⇒ `LOCAL_PRINCIPAL`（本地回环信任基线，桌面端行为不变）；
 *   - 非 Bearer 形式（如 `x-api-key`、`Token ...`）⇒ `LOCAL_PRINCIPAL`
 *     —— 共享密钥代表**机器级信任**，不携带用户身份；
 *   - Bearer 且在 `authTokens` 里 ⇒ `{ tenantId: 'local', userId: username, roles: [角色] }`
 *     —— 角色由 `resolveRoleFromPermissions` 映射（与登录写进程级角色**同一实现**），
 *     故请求级判定与改造前结果一致；租户维度待 P1 存储分区引入租户目录后填充，
 *     阶段 2 不臆造租户；
 *   - Bearer 但无效 ⇒ `LOCAL_PRINCIPAL`（该请求已在 `LocalHTTPService.handleRequest`
 *     的鉴权分支被 401 掉，这里不重复抛错，也不编造身份）。
 *
 * 为什么动态 `import('auth-handlers')`：与该文件既有做法一致
 * （`LocalHTTPService.ts` 的 401 分支即如此）—— 避免 http 根模块静态依赖 handlers
 * 带来的初始化顺序耦合。
 */
import type http from 'http';

import {
  LOCAL_PRINCIPAL,
  normalizePrincipal,
  type Principal,
} from '@modules/core/identity/principal.js';
import { runWithPrincipal } from '../../core/identity/requestScope.js';

/** `authTokens` 的 value 形状（只读消费，避免把 handlers 的类型拖成静态依赖） */
interface AuthTokenSession {
  username: string;
  permissions: string[];
}

export async function resolveRequestPrincipal(
  req: http.IncomingMessage
): Promise<Principal> {
  const header = req.headers['authorization'] ?? '';
  if (!header.startsWith('Bearer ')) return LOCAL_PRINCIPAL;

  const token = header.slice(7);
  if (!token) return LOCAL_PRINCIPAL;

  const { authTokens, resolveRoleFromPermissions } =
    await import('./handlers/auth-handlers');
  const session = authTokens.get(token) as AuthTokenSession | undefined;
  if (!session) return LOCAL_PRINCIPAL;

  return normalizePrincipal({
    userId: session.username,
    // 角色口径与登录写进程级角色**同源**（`resolveRoleFromPermissions`）
    // ⇒ 请求级判定与改造前的进程级判定结果一致，只是不再互相覆盖。
    roles: [resolveRoleFromPermissions(session.permissions)],
  });
}

/**
 * 在**本次请求的身份作用域**内执行 `fn`（HTTP 入口唯一调用点）。
 *
 * 单独抽出的原因：把"解析身份 + 建立作用域"这两步绑定成一个可测的单元
 * —— 若入口侧的接线被摘掉，`requestIdentity` 的用例会立刻变红（纯函数用例不会）。
 */
export async function withRequestIdentity<T>(
  req: http.IncomingMessage,
  fn: () => Promise<T>
): Promise<T> {
  const principal = await resolveRequestPrincipal(req);
  return runWithPrincipal(principal, fn);
}
