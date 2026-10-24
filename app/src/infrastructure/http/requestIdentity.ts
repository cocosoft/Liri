/**
 * requestIdentity — HTTP 请求 → `Principal` 解析（多租户 P0 · 阶段 2）
 *
 * 口径（**保持既有鉴权语义不变**，只补身份解析）：
 *   - 无 `Authorization: Bearer` ⇒ `LOCAL_PRINCIPAL`（本地回环信任基线，桌面端行为不变）；
 *   - 非 Bearer 形式（如 `x-api-key`、`Token ...`）⇒ `LOCAL_PRINCIPAL`
 *     —— 共享密钥代表**机器级信任**，不携带用户身份；
 *   - Bearer 且在 `authTokens` 里 ⇒ `{ tenantId: <账号绑定租户>, userId: username, roles: [角色] }`
 *     —— 角色由 `resolveRoleFromPermissions` 映射（与登录写进程级角色**同一实现**），
 *     故请求级判定与改造前结果一致；
 *   - Bearer 但无效 ⇒ `LOCAL_PRINCIPAL`（该请求已在 `LocalHTTPService.handleRequest`
 *     的鉴权分支被 401 掉，这里不重复抛错，也不编造身份）。
 *
 * **租户从哪来（多租户 P3）**：`tenantId` 是**账号属性**（`{data}/auth/users.json`），
 * 注册时按 `LIRI_TENANT_SELF_REGISTER` 开关绑定、登录时写进 token session；
 * 老用户 / 老 token 无该字段 ⇒ 回落 `LOCAL_TENANT_ID`（桌面端逐字不变）。
 * 请求头与登录 body 都**不能**切换租户 —— 否则等于让调用方自报身份。
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
} from '@openliri/kernel/identity/principal.js';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';
import { getDIContainer } from '@openliri/kernel';

/** `authTokens` 的 value 形状（只读消费，避免把 handlers 的类型拖成静态依赖） */
interface AuthTokenSession {
  username: string;
  permissions: string[];
  /** 账号绑定租户（缺省 ⇒ 本地身份；见 `auth-handlers#decideRegistrationTenant`） */
  tenantId?: string;
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
    // 租户取自账号绑定；缺失 / 空白 ⇒ normalizePrincipal 回落 `'local'`（不编造租户）
    tenantId: session.tenantId,
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
 *
 * **ADR（2026-10-24 拍板）**：`request` 作用域**保留并在此接线**，不删。
 * 理由：① 删除会失去「每请求一份实例」的能力，SSE 长连接/多租户明确需要它；
 * ② 当前全仓**零** `scope: 'request'` 注册 ⇒ 本接线是**零行为变更**的接缝；
 * ③ 相比"一段只有测试在跑的代码"，接在唯一入口上更诚实。
 * 边界由 `runInRequestScope`（`AsyncLocalStorage.run`）保证，异常路径也不泄漏。
 */
export async function withRequestIdentity<T>(
  req: http.IncomingMessage,
  fn: () => Promise<T>
): Promise<T> {
  const principal = await resolveRequestPrincipal(req);
  return runWithPrincipal(principal, () =>
    getDIContainer().runInRequestScope(fn)
  );
}
