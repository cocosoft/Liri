/**
 * adminWriteRoutes — 「哪些请求必须过 admin 校验」的**唯一事实源**（W26-15，2026-10-26）
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
 * 也不决定状态码。
 *
 * 「校验点与路由定义同址」由此处的**数据声明表**承担：新增管理写路由 = 往
 * `ADMIN_WRITE_PREFIXES` / `PLUGIN_ADMIN_SUFFIXES` 加一条（同文件、紧邻规则），
 * 不再需要回 `route-table.ts` 改内联条件。W26-17（2026-10-26）已裁定：不再为
 * 「adminOnly 声明化」引入 `RouteRegistry` 那一层（该抽象已退役，见该文件删除提交）。
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

/** 需要 admin 权限的**读**方法（当前只有 GET） */
const ADMIN_READ_METHODS: ReadonlySet<string> = new Set(['GET']);

/**
 * 需要 admin 权限的**读**路径（段边界）。
 *
 * 2026-11-11（P1-1）：RBAC 快照会暴露全量 `roles/users/resources/bindings`
 * （即整机权限策略），而此前 GET 完全不受管理面校验 ⇒ 任意登录用户可读。
 *
 * 为什么单列白名单、不卡整棵 `/v1/permissions` 读面：
 * `/v1/permissions/rules` 与 `/metrics` 是设置页/看板的既有读入口（登录用户可见），
 * 一并收窄会改变既有行为；本条目只覆盖真正泄露策略面的 RBAC 快照。
 */
const ADMIN_READ_PATHS = ['/v1/permissions/rbac'] as const;

/**
 * 段边界前缀（**不带**尾斜杠；同时匹配自身与其子路径）。
 *
 * 逐条来源：
 *   - `/v1/permissions`：权限规则 / 用户 / 角色 / 资源 / 授权的写入
 *   - `/v1/apikeys`：API 密钥签发与吊销
 *   - `/v1/oauth/providers`：OAuth 供应商凭据
 *   - `/v1/skills`：skill 的 install/uninstall/delete/import/clone/update/toggle/create（M1，2026-08-06）
 *   - `/v1/system/shutdown`：优雅关闭（2026-11-12；本机无 Bearer 时 `checkAdminRequest` 直接放行，
 *     已登录但非 admin 的会话不得停机）
 *   - `/v1/tenants`：删除租户会清空整租户数据（多租户 P5，2026-10-21）
 */
const ADMIN_WRITE_PREFIXES = [
  '/v1/apikeys',
  '/v1/oauth/providers',
  '/v1/permissions',
  '/v1/skills',
  '/v1/system/shutdown',
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

/**
 * 该请求是否属于**管理读 API**（RBAC 策略面快照，2026-11-11）。
 *
 * @param method - HTTP 方法（大小写不敏感；当前只认 `GET`）
 * @param pathname - 已去查询串的路径
 */
export function isAdminReadRoute(method: string, pathname: string): boolean {
  if (!ADMIN_READ_METHODS.has(method.toUpperCase())) return false;
  return ADMIN_READ_PATHS.some((path) => matchesSegmentPrefix(pathname, path));
}

/**
 * **管理面**（读 + 写）统一判定 —— `dispatchRoute` 的唯一调用入口。
 *
 * 读写分开判定的原因见 `ADMIN_READ_PATHS` 注释：收窄范围被刻意控制在
 * 「会泄露整机策略」的读接口上。
 */
export function requiresAdminApi(method: string, pathname: string): boolean {
  return (
    isAdminWriteRoute(method, pathname) || isAdminReadRoute(method, pathname)
  );
}
