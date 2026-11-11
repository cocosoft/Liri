/**
 * Fine-grained RBAC panel strings (2026-11-11)
 *
 * Kept in a separate file because `knowledge.ts` is already near the 2000-line
 * hard limit enforced by `lint:size` (R04-001). Merged into the `permission`
 * object of `knowledge.ts`, so the public namespace is still `permission.*`.
 */
const enRbacPermission = {
  rbacTitle: "Fine-grained RBAC",
  rbacDesc:
    "Bind tool permissions to roles / users / resources; supports deny / allow / ask (deny > ask > allow). Resource bindings are tool-only (type=tool, path = tool name). Data lives in permissions/{roles,users,resources,rules}.json.",
  rbacRoles: "Roles",
  rbacRoleDescPlaceholder: "Role description (optional)",
  rbacAddRole: "Add role",
  rbacUsers: "Users",
  rbacUserPlaceholder: "User name",
  rbacAddUser: "Add user",
  rbacResources: "Resources",
  rbacResourcePathPlaceholder: "Path / tool name",
  rbacAddResource: "Add resource",
  rbacBind: "Bindings",
  rbacBindAction: "Bind",
  rbacBindHint:
    "For role/user, fill subject and tool name; for resource, fill the tool name (tool-only bindings participate in checks).",
  rbacSubject_role: "Role",
  rbacSubject_user: "User",
  rbacSubject_resource: "Resource",
  rbacSubjectPlaceholder: "Subject (role/user name or resource path)",
  rbacToolPlaceholder: "Tool name (e.g. bash)",
  rbacRuleCount: "{{count}} bindings",
  rbacUnbind: "Unbind",
  rbacNoRoles: "No roles",
  rbacNoUsers: "No users",
  rbacNoResources: "No resources",
  rbacNoBindings: "No bindings",
  rbacRole: "role",
  rbacUser: "user",
  rbacResource: "resource",
} as const;

export default enRbacPermission;
