/**
 * adminWriteRoutes — 「哪些写请求必须过 admin 校验」的**唯一事实源**（W26-15，2026-10-26）
 *
 * ## 背景
 * 该判定此前**内联**在 `handlers/route-table.ts` 的 `dispatchRoute` 里，形态是裸
 * `url.startsWith('/v1/skills')`。前缀不是**段边界** ⇒ `/v1/skills` 会连
 * `/v1/skillsets`、`/v1/skills-*` 一起套上 admin 校验（方向偏严但不可预期），
 * 反过来大小写 / 编码变体又可能**静默绕过**；且内联形态无法用单测覆盖。
 *
 * ## 本模块边界
 * 只做**纯判定**（零 IO、零依赖）：`(method, pathname) → boolean`。
 * 段边界口径：`pathname === prefix || pathname.startsWith(prefix + '/')`。
 *
 * ⚠️ **本模块只管"是否属于管理写"，不做鉴权本身**（鉴权仍是 `auth-handlers#checkAdminRequest`），
 * 也不决定状态码 —— 校验点与路由定义的合并见 W26-17（`RouteRegistry` 接线后 `adminOnly` 声明化）。
 *
 * 与既有语义的**唯一**差异：`/v1/permissions` **裸路径**此前不匹配（原断言带尾斜杠），
 * 现按段边界匹配会覆盖它。仓内不存在该裸路径的写路由（实测全部为 `/v1/permissions/...`），
 * 且方向偏严（fail-closed），故不构成对真实流量的行为变更。
 */

/** 需要 admin 权限的写方法（`GET`/`HEAD`/`OPTIONS` 不在此列） */
const ADMIN_WRITE_METHODS: ReadonlySet<string> = new Set([
  'POST',
  'PUT',
  'DELETE',
]);

/**
 * 段边界前缀（**不带**尾斜杠；同时匹配自身与其子路径）。
 *
 * 逐条来源：
 *   - `/v1/permissions`：权限规则 / 用户 / 角色 / 资源 / 授权的写入
 *   - `/v1/apikeys`：API 密钥签发与吊销
 *   - `/v1/oauth/providers`：OAuth 供应商凭据
 *   - `/v1/skills`：skill 的 install/uninstall/delete/import/clone/update/toggle/create（M1，2026-08-06）
 *   - `/v1/tenants`：删除租户会清空整租户数据（多租户 P5，2026-10-21）
 */
const ADMIN_WRITE_PREFIXES = [
  '/v1/apikeys',
  '/v1/oauth/providers',
  '/v1/permissions',
  '/v1/skills',
  '/v1/tenants',
] as const;

/** 插件市场前缀（**带**尾斜杠 ⇒ 本身已是段边界） */
const PLUGIN_MARKETPLACE_PREFIX = '/v1/plugins/marketplace/plugins/';

/**
 * 插件市场里**仅**这两个子资源属管理写：
 *   - `/capabilities`：能力授权变更（T25-08 P2）
 *   - `/config`：运行参数变更（2026-10-26）
 *
 * 刻意**不**扩大为整棵子树 —— 安装 / 卸载口径保持不变。
 */
const PLUGIN_ADMIN_SUFFIXES = ['/capabilities', '/config'] as const;

function matchesSegmentPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * 该请求是否属于**管理写 API**（需要 `checkAdminRequest` 校验）。
 *
 * @param method - HTTP 方法（大小写不敏感）
 * @param pathname - 已去查询串的路径（`LocalHTTPService` 传入前已 `split('?')[0]`）
 */
export function isAdminWriteRoute(method: string, pathname: string): boolean {
  if (!ADMIN_WRITE_METHODS.has(method.toUpperCase())) return false;

  if (
    ADMIN_WRITE_PREFIXES.some((prefix) =>
      matchesSegmentPrefix(pathname, prefix)
    )
  ) {
    return true;
  }

  return (
    pathname.startsWith(PLUGIN_MARKETPLACE_PREFIX) &&
    PLUGIN_ADMIN_SUFFIXES.some((suffix) => pathname.endsWith(suffix))
  );
}
