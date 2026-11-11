/**
 * 细粒度 RBAC 面板（角色 / 用户 / 资源 / 绑定）
 *
 * 数据源：
 * - 读：`GET /v1/permissions/rbac`（快照）
 * - 写：`POST /v1/permissions/rbac { command }`，命令语法与 CLI `/permissions` 完全一致
 *   （后端经 CommandsOpsPort 复用同一个命令执行器 ⇒ 面板与 CLI 不会漂移）。
 *
 * 判定语义：绑定支持 deny / allow / ask，优先级 deny > ask > allow；
 * 资源绑定以「类型 + 路径」为标识（工具类资源路径写工具名）。
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  permissionService,
  type RbacBinding,
  type RbacSnapshot,
} from "../../services/permissionService";
import { handleClientError } from "../../utils/handleError";

// 前端展示用的选项清单（与后端枚举同值；两个部署单元无法共享模块，
// 因此用 UI_ 前缀区分，避免 `lint:consts` 的「同名常量跨文件」判重）
const UI_ROLE_NAMES = ["admin", "user", "guest", "system"] as const;
const UI_RESOURCE_TYPES = [
  "tool",
  "file",
  "directory",
  "api",
  "command",
  "system",
] as const;
const UI_BIND_ACTIONS = ["deny", "allow", "ask"] as const;
const UI_BIND_OPERATIONS = ["execute", "all"] as const;
const SUBJECT_TYPES = ["role", "user", "resource"] as const;

type RoleName = (typeof UI_ROLE_NAMES)[number];
type ResourceType = (typeof UI_RESOURCE_TYPES)[number];
type BindAction = (typeof UI_BIND_ACTIONS)[number];
type BindOperation = (typeof UI_BIND_OPERATIONS)[number];
type SubjectType = (typeof SUBJECT_TYPES)[number];

interface RbacPanelProps {
  isDark: boolean;
}

function RbacPanel({ isDark }: RbacPanelProps) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<RbacSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackIsError, setFeedbackIsError] = useState(false);

  // 角色表单
  const [roleName, setRoleName] = useState<RoleName>("guest");
  const [roleDesc, setRoleDesc] = useState("");
  // 用户表单
  const [userName, setUserName] = useState("");
  const [userRole, setUserRole] = useState<RoleName>("guest");
  // 资源表单
  const [resourceType, setResourceType] = useState<ResourceType>("tool");
  const [resourcePath, setResourcePath] = useState("");
  // 绑定表单
  const [subjectType, setSubjectType] = useState<SubjectType>("role");
  const [subject, setSubject] = useState("");
  const [bindTool, setBindTool] = useState("");
  const [bindAction, setBindAction] = useState<BindAction>("deny");
  const [bindOperation, setBindOperation] = useState<BindOperation>("execute");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSnapshot(await permissionService.getRbac());
    } catch (e) {
      handleClientError(e, { module: "permission:rbac", action: "load" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * 执行一条 RBAC 命令（面板内反馈成功/失败；成功后可选清空相关输入）
   *
   * 失败分支：后端对业务失败返回 400 且 body 为 `{success:false,message}`，
   * httpClient 的 formatError 会把 `message` 提取到 Error.message ⇒ 面板直接展示。
   */
  const run = async (command: string, onSuccess?: () => void) => {
    if (!command || busy) return;
    setBusy(true);
    try {
      const result = await permissionService.runRbac(command);
      if (!result.success) {
        setFeedbackIsError(true);
        setFeedback(result.message);
        return;
      }
      setFeedbackIsError(false);
      setFeedback(result.message);
      onSuccess?.();
      await load();
    } catch (e) {
      setFeedbackIsError(true);
      setFeedback(e instanceof Error ? e.message : String(e));
      handleClientError(e, { module: "permission:rbac", action: command });
    } finally {
      setBusy(false);
    }
  };

  const inputCls = `px-2 py-1.5 text-xs rounded border ${
    isDark
      ? "bg-gray-700 border-gray-600 text-gray-200 placeholder-gray-500"
      : "bg-white border-gray-300 text-gray-800 placeholder-gray-400"
  }`;
  const selectCls = inputCls;
  const primaryBtn =
    "px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded";
  const subtleBtn = `px-3 py-1 text-xs rounded ${
    isDark
      ? "bg-gray-700 hover:bg-gray-600 text-gray-300"
      : "bg-gray-200 hover:bg-gray-300 text-gray-700"
  }`;
  const sectionTitle = `text-sm font-medium mb-2 ${
    isDark ? "text-gray-200" : "text-gray-800"
  }`;
  const emptyHint = `text-xs p-3 rounded-lg text-center ${
    isDark ? "bg-gray-700/50 text-gray-400" : "bg-gray-50 text-gray-500"
  }`;
  const rowCls = `flex items-center justify-between p-2 rounded-lg ${
    isDark ? "bg-gray-700/50" : "bg-gray-50"
  }`;

  const bindCommand = () => {
    const target = subject.trim();
    if (!target) return "";
    if (subjectType === "resource") {
      return `resource bind ${resourceType} ${target} ${bindAction} ${bindOperation}`;
    }
    const tool = bindTool.trim();
    if (!tool) return "";
    return `${subjectType} bind ${target} ${tool} ${bindAction} ${bindOperation}`;
  };

  const unbindCommand = (binding: RbacBinding): string | null => {
    if (binding.roleId) {
      return `role unbind ${binding.roleId} ${binding.resourceId}`;
    }
    if (binding.userId) {
      return `user unbind ${binding.userId} ${binding.resourceId}`;
    }
    const resource = snapshot?.resources.find(
      (item) => item.path === binding.resourceId,
    );
    return resource
      ? `resource unbind ${resource.type} ${binding.resourceId}`
      : null;
  };

  const renderBinding = (binding: RbacBinding) => {
    const command = unbindCommand(binding);
    return (
      <div key={binding.id} className={rowCls}>
        <div className="flex items-center gap-2 min-w-0 text-xs">
          <span
            className={`px-1.5 py-0.5 rounded shrink-0 ${
              binding.action === "allow"
                ? isDark
                  ? "bg-green-900/30 text-green-400"
                  : "bg-green-100 text-green-700"
                : binding.action === "deny"
                  ? isDark
                    ? "bg-red-900/30 text-red-400"
                    : "bg-red-100 text-red-700"
                  : isDark
                    ? "bg-yellow-900/30 text-yellow-400"
                    : "bg-yellow-100 text-yellow-700"
            }`}
          >
            {binding.action}
          </span>
          <span
            className={`font-mono truncate ${isDark ? "text-gray-200" : "text-gray-800"}`}
          >
            {binding.roleId
              ? `${t("permission.rbacRole")}:${binding.roleId}`
              : binding.userId
                ? `${t("permission.rbacUser")}:${binding.userId}`
                : t("permission.rbacResource")}
            {" → "}
            {binding.resourceId}({binding.operation})
          </span>
        </div>
        {command && (
          <button
            onClick={() => run(command)}
            className="text-xs text-red-500 hover:text-red-400 shrink-0 ml-2"
          >
            {t("permission.rbacUnbind")}
          </button>
        )}
      </div>
    );
  };

  return (
    <div
      className={`mt-6 ${isDark ? "bg-gray-800" : "bg-white"} rounded-lg border ${
        isDark ? "border-gray-700" : "border-gray-200"
      } p-6`}
    >
      <div className="flex items-center justify-between mb-2">
        <h3
          className={`text-lg font-semibold ${
            isDark ? "text-gray-100" : "text-gray-900"
          }`}
        >
          {t("permission.rbacTitle")}
        </h3>
        <button onClick={load} disabled={loading} className={subtleBtn}>
          {loading ? t("common.loading") : t("common.refresh")}
        </button>
      </div>
      <p
        className={`text-xs mb-4 ${isDark ? "text-gray-500" : "text-gray-500"}`}
      >
        {t("permission.rbacDesc")}
      </p>
      {feedback && (
        <p
          className={`text-xs mb-3 ${
            feedbackIsError
              ? isDark
                ? "text-red-400"
                : "text-red-600"
              : isDark
                ? "text-blue-400"
                : "text-blue-600"
          }`}
        >
          {feedback}
        </p>
      )}

      {/* 角色 */}
      <div className="mb-5">
        <h4 className={sectionTitle}>{t("permission.rbacRoles")}</h4>
        <div className="flex gap-2 mb-2">
          <select
            value={roleName}
            onChange={(e) => setRoleName(e.target.value as RoleName)}
            className={selectCls}
          >
            {UI_ROLE_NAMES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <input
            placeholder={t("permission.rbacRoleDescPlaceholder")}
            value={roleDesc}
            onChange={(e) => setRoleDesc(e.target.value)}
            className={`flex-1 ${inputCls}`}
          />
          <button
            onClick={() =>
              run(
                `role add ${roleName}${roleDesc.trim() ? ` ${roleDesc.trim()}` : ""}`,
                () => setRoleDesc(""),
              )
            }
            disabled={busy}
            className={primaryBtn}
          >
            {t("permission.rbacAddRole")}
          </button>
        </div>
        {snapshot && snapshot.roles.length > 0 ? (
          <div className="space-y-2">
            {snapshot.roles.map((role) => (
              <div key={role.id} className={rowCls}>
                <span
                  className={`text-xs ${isDark ? "text-gray-200" : "text-gray-800"}`}
                >
                  <span className="font-mono">{role.name}</span>
                  {role.description ? `（${role.description}）` : ""} ·{" "}
                  {t("permission.rbacRuleCount", { count: role.ruleCount })}
                </span>
                <button
                  onClick={() => run(`role remove ${role.name}`)}
                  className="text-xs text-red-500 hover:text-red-400"
                >
                  {t("common.delete")}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className={emptyHint}>{t("permission.rbacNoRoles")}</p>
        )}
      </div>

      {/* 用户 */}
      <div className="mb-5">
        <h4 className={sectionTitle}>{t("permission.rbacUsers")}</h4>
        <div className="flex gap-2 mb-2">
          <input
            placeholder={t("permission.rbacUserPlaceholder")}
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            className={`flex-1 ${inputCls}`}
          />
          <select
            value={userRole}
            onChange={(e) => setUserRole(e.target.value as RoleName)}
            className={selectCls}
          >
            {UI_ROLE_NAMES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button
            onClick={() =>
              run(`user add ${userName.trim()} ${userRole}`, () =>
                setUserName(""),
              )
            }
            disabled={busy || !userName.trim()}
            className={primaryBtn}
          >
            {t("permission.rbacAddUser")}
          </button>
        </div>
        {snapshot && snapshot.users.length > 0 ? (
          <div className="space-y-2">
            {snapshot.users.map((user) => (
              <div key={user.id} className={rowCls}>
                <span
                  className={`text-xs ${isDark ? "text-gray-200" : "text-gray-800"}`}
                >
                  <span className="font-mono">{user.name}</span> ·{" "}
                  {user.roles.join(", ")} ·{" "}
                  {t("permission.rbacRuleCount", { count: user.ruleCount })}
                </span>
                <div className="flex items-center gap-2">
                  <select
                    value={user.roles[0] ?? "guest"}
                    onChange={(e) =>
                      run(`user role ${user.name} ${e.target.value}`)
                    }
                    className={selectCls}
                  >
                    {UI_ROLE_NAMES.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => run(`user remove ${user.name}`)}
                    className="text-xs text-red-500 hover:text-red-400"
                  >
                    {t("common.delete")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className={emptyHint}>{t("permission.rbacNoUsers")}</p>
        )}
      </div>

      {/* 资源 */}
      <div className="mb-5">
        <h4 className={sectionTitle}>{t("permission.rbacResources")}</h4>
        <div className="flex gap-2 mb-2">
          <select
            value={resourceType}
            onChange={(e) => setResourceType(e.target.value as ResourceType)}
            className={selectCls}
          >
            {UI_RESOURCE_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <input
            placeholder={t("permission.rbacResourcePathPlaceholder")}
            value={resourcePath}
            onChange={(e) => setResourcePath(e.target.value)}
            className={`flex-1 ${inputCls}`}
          />
          <button
            onClick={() =>
              run(`resource add ${resourceType} ${resourcePath.trim()}`, () =>
                setResourcePath(""),
              )
            }
            disabled={busy || !resourcePath.trim()}
            className={primaryBtn}
          >
            {t("permission.rbacAddResource")}
          </button>
        </div>
        {snapshot && snapshot.resources.length > 0 ? (
          <div className="space-y-2">
            {snapshot.resources.map((resource) => (
              <div key={resource.id} className={rowCls}>
                <span
                  className={`text-xs ${isDark ? "text-gray-200" : "text-gray-800"}`}
                >
                  <span className="font-mono">
                    {resource.type}:{resource.path ?? resource.name}
                  </span>{" "}
                  ·{" "}
                  {t("permission.rbacRuleCount", { count: resource.ruleCount })}
                </span>
                <button
                  onClick={() =>
                    run(
                      `resource remove ${resource.type} ${resource.path ?? resource.name}`,
                    )
                  }
                  className="text-xs text-red-500 hover:text-red-400"
                >
                  {t("common.delete")}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className={emptyHint}>{t("permission.rbacNoResources")}</p>
        )}
      </div>

      {/* 绑定 */}
      <div className="mb-4">
        <h4 className={sectionTitle}>{t("permission.rbacBind")}</h4>
        <div className="flex flex-wrap gap-2 mb-2">
          <select
            value={subjectType}
            onChange={(e) => setSubjectType(e.target.value as SubjectType)}
            className={selectCls}
          >
            {SUBJECT_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`permission.rbacSubject_${type}`)}
              </option>
            ))}
          </select>
          <input
            placeholder={t("permission.rbacSubjectPlaceholder")}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className={inputCls}
          />
          {subjectType !== "resource" && (
            <input
              placeholder={t("permission.rbacToolPlaceholder")}
              value={bindTool}
              onChange={(e) => setBindTool(e.target.value)}
              className={inputCls}
            />
          )}
          <select
            value={bindAction}
            onChange={(e) => setBindAction(e.target.value as BindAction)}
            className={selectCls}
          >
            {UI_BIND_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>
          <select
            value={bindOperation}
            onChange={(e) => setBindOperation(e.target.value as BindOperation)}
            className={selectCls}
          >
            {UI_BIND_OPERATIONS.map((operation) => (
              <option key={operation} value={operation}>
                {operation}
              </option>
            ))}
          </select>
          <button
            onClick={() =>
              run(bindCommand(), () => {
                setSubject("");
                setBindTool("");
              })
            }
            disabled={busy || !bindCommand()}
            className={primaryBtn}
          >
            {t("permission.rbacBindAction")}
          </button>
        </div>
        <p
          className={`text-xs mb-2 ${isDark ? "text-gray-500" : "text-gray-500"}`}
        >
          {t("permission.rbacBindHint")}
        </p>
        {snapshot && snapshot.bindings.length > 0 ? (
          <div className="space-y-2">
            {snapshot.bindings.map(renderBinding)}
          </div>
        ) : (
          <p className={emptyHint}>{t("permission.rbacNoBindings")}</p>
        )}
      </div>
    </div>
  );
}

export default RbacPanel;
