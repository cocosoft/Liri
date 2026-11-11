/**
 * 细粒度 RBAC 面板文案（2026-11-11）
 *
 * 独立成文件的原因：`knowledge.ts` 已接近 `lint:size` 的 2000 行硬上限，
 * 新增文案直接并入会把该语言包顶成错误（R04-001）。此处仅承载 RBAC 面板所需键，
 * 由 `knowledge.ts` 的 `permission` 对象展开合并（对外仍是 `permission.*` 同一命名空间）。
 */
const zhRbacPermission = {
  rbacTitle: "细粒度 RBAC",
  rbacDesc:
    "按角色 / 用户 / 资源绑定工具权限；支持 deny / allow / ask，优先级 deny > ask > allow。数据存于 permissions/{roles,users,resources,rules}.json。",
  rbacRoles: "角色",
  rbacRoleDescPlaceholder: "角色描述（可选）",
  rbacAddRole: "添加角色",
  rbacUsers: "用户",
  rbacUserPlaceholder: "用户名",
  rbacAddUser: "添加用户",
  rbacResources: "资源",
  rbacResourcePathPlaceholder: "路径 / 工具名",
  rbacAddResource: "添加资源",
  rbacBind: "绑定规则",
  rbacBindAction: "绑定",
  rbacBindHint:
    "角色/用户填写主体名与工具名；资源填写「类型 + 路径」（工具类资源路径即工具名）。",
  rbacSubject_role: "角色",
  rbacSubject_user: "用户",
  rbacSubject_resource: "资源",
  rbacSubjectPlaceholder: "主体名（角色/用户名或资源路径）",
  rbacToolPlaceholder: "工具名（如 bash）",
  rbacRuleCount: "{{count}} 条绑定",
  rbacUnbind: "解绑",
  rbacNoRoles: "暂无角色",
  rbacNoUsers: "暂无用户",
  rbacNoResources: "暂无资源",
  rbacNoBindings: "暂无绑定",
  rbacRole: "角色",
  rbacUser: "用户",
  rbacResource: "资源",
} as const;

export default zhRbacPermission;
