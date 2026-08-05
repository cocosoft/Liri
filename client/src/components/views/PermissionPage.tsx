import { useState, useEffect } from "react";
import { useConfigStore } from "../../stores/configStore";
import { authService, type Permission } from "../../services/authService";
import {
  permissionService,
  type PermissionRule,
} from "../../services/permissionService";
import { handleClientError } from "../../utils/handleError";

interface UserPermission {
  id: string;
  username: string;
  email: string;
  role: "admin" | "user" | "guest";
  trustLevel: number;
  permissions: string[];
  lastActive: string;
}

interface PermissionItem {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

const TRUST_LEVELS = [
  {
    level: 0,
    name: "完全隔离",
    description: "无网络、无文件、系统隔离",
    color: "gray",
  },
  {
    level: 1,
    name: "受限",
    description: "受限网络访问、只读文件系统",
    color: "red",
  },
  {
    level: 2,
    name: "标准",
    description: "标准访问权限、有限写入",
    color: "yellow",
  },
  {
    level: 3,
    name: "可信",
    description: "完全网络、完全读写、系统调用",
    color: "green",
  },
  {
    level: 4,
    name: "管理员",
    description: "完全信任、所有权限",
    color: "blue",
  },
];

function PermissionPage() {
  const { config, loadConfig } = useConfigStore();
  const isDark = config.theme === "dark";
  // CS04：禁止 mock。权限用户管理 API 尚未提供，先渲染空态（"暂无用户数据"）
  const [users, setUsers] = useState<UserPermission[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserPermission | null>(null);
  const [systemPermissions, setSystemPermissions] = useState<PermissionItem[]>(
    [],
  );
  const [permissionsLoading, setPermissionsLoading] = useState(true);
  // P1-5：工具权限规则（真实 API /v1/permissions/rules）
  const [rules, setRules] = useState<PermissionRule[]>([]);
  const [rulesSummary, setRulesSummary] = useState({
    total: 0,
    allow: 0,
    deny: 0,
    ask: 0,
  });
  const [rulesLoading, setRulesLoading] = useState(false);
  const [ruleBehavior, setRuleBehavior] = useState<"allow" | "deny" | "ask">(
    "deny",
  );
  const [ruleToolName, setRuleToolName] = useState("");
  const [ruleContentPattern, setRuleContentPattern] = useState("");
  // 影子规则（遮蔽冲突）检测结果
  const [shadowDetection, setShadowDetection] = useState<{
    shadowedCount: number;
    isValid: boolean;
    suggestions: string[];
  } | null>(null);

  useEffect(() => {
    loadConfig();
    loadPermissions();
    loadRules();
    loadUsers();
  }, [loadConfig]);

  const loadPermissions = async () => {
    if (!authService.isAuthenticated()) {
      setPermissionsLoading(false);
      return;
    }
    setPermissionsLoading(true);
    try {
      const perms = await authService.getPermissions();
      setSystemPermissions(
        perms.map((p: Permission, idx: number) => ({
          id: p.scope || `perm_${idx}`,
          name: p.scope,
          description: p.description || `${p.scope} 权限`,
          enabled: p.level !== "none",
        })),
      );
    } catch (e) {
      // CS04：禁止 mock 回退。加载失败即空态 + 报错，不填充默认配置
      handleClientError(e, {
        module: "permission:page",
        action: "loadPermissions",
      });
      setSystemPermissions([]);
    } finally {
      setPermissionsLoading(false);
    }
  };

  // P1-5：工具权限规则加载/添加/删除
  const loadRules = async () => {
    setRulesLoading(true);
    try {
      const data = await permissionService.listRules();
      setRules(data.rules);
      setRulesSummary(data.summary);
      setShadowDetection(data.shadowDetection ?? null);
    } catch (e) {
      handleClientError(e, { module: "permission:page", action: "loadRules" });
    } finally {
      setRulesLoading(false);
    }
  };

  const addRule = async () => {
    const toolName = ruleToolName.trim();
    if (!toolName) return;
    try {
      await permissionService.addRule(
        ruleBehavior,
        toolName,
        ruleContentPattern.trim() || undefined,
      );
      setRuleToolName("");
      setRuleContentPattern("");
      await loadRules();
    } catch (e) {
      handleClientError(e, { module: "permission:page", action: "addRule" });
    }
  };

  const deleteRule = async (ruleId: string) => {
    try {
      await permissionService.deleteRule(ruleId);
      await loadRules();
    } catch (e) {
      handleClientError(e, {
        module: "permission:page",
        action: "deleteRule",
      });
    }
  };

  // P2-7：细粒度用户列表（D 体系 /v1/permissions/users，只读）
  const loadUsers = async () => {
    try {
      const list = await permissionService.listUsers();
      setUsers(
        list.map((u) => ({
          id: u.id,
          username: u.name,
          email: "",
          role:
            u.roles.includes("admin") || u.roles.includes("system")
              ? "admin"
              : u.roles.includes("guest")
                ? "guest"
                : "user",
          trustLevel:
            u.roles.includes("admin") || u.roles.includes("system")
              ? 4
              : u.roles.includes("guest")
                ? 0
                : 2,
          permissions: u.roles,
          lastActive: u.updatedAt
            ? new Date(u.updatedAt).toLocaleString()
            : "—",
        })),
      );
    } catch (e) {
      handleClientError(e, { module: "permission:page", action: "loadUsers" });
    }
  };

  const getTrustLevelInfo = (level: number) => {
    return TRUST_LEVELS.find((t) => t.level === level) || TRUST_LEVELS[0];
  };

  const getTrustLevelColor = (level: number) => {
    const info = getTrustLevelInfo(level);
    switch (info.color) {
      case "gray":
        return isDark
          ? "bg-gray-700 text-gray-300"
          : "bg-gray-100 text-gray-600";
      case "red":
        return isDark
          ? "bg-red-900/30 text-red-400"
          : "bg-red-100 text-red-600";
      case "yellow":
        return isDark
          ? "bg-yellow-900/30 text-yellow-400"
          : "bg-yellow-100 text-yellow-600";
      case "green":
        return isDark
          ? "bg-green-900/30 text-green-400"
          : "bg-green-100 text-green-600";
      case "blue":
        return isDark
          ? "bg-blue-900/30 text-blue-400"
          : "bg-blue-100 text-blue-600";
      default:
        return isDark
          ? "bg-gray-700 text-gray-300"
          : "bg-gray-100 text-gray-600";
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case "admin":
        return isDark
          ? "bg-purple-900/30 text-purple-400"
          : "bg-purple-100 text-purple-600";
      case "user":
        return isDark
          ? "bg-blue-900/30 text-blue-400"
          : "bg-blue-100 text-blue-600";
      case "guest":
        return isDark
          ? "bg-gray-700 text-gray-400"
          : "bg-gray-100 text-gray-600";
      default:
        return isDark
          ? "bg-gray-700 text-gray-400"
          : "bg-gray-100 text-gray-600";
    }
  };

  const togglePermission = (id: string) => {
    setSystemPermissions((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)),
    );
  };

  // M0e：角色编辑持久化（PUT /v1/permissions/users/{id}），失败保留原值
  const updateUserRole = async (
    userId: string,
    role: "admin" | "user" | "guest",
  ) => {
    try {
      await permissionService.updateUserRoles(userId, [role]);
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role } : u)),
      );
      if (selectedUser?.id === userId) {
        setSelectedUser((prev) => (prev ? { ...prev, role } : null));
      }
    } catch (e) {
      handleClientError(e, {
        module: "permission:page",
        action: "updateUserRole",
      });
    }
  };

  return (
    <div
      className={`flex-1 overflow-y-auto ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
    >
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex gap-6">
          <div
            className={`w-80 flex-shrink-0 ${isDark ? "bg-gray-800" : "bg-white"} rounded-lg border ${isDark ? "border-gray-700" : "border-gray-200"} p-4`}
          >
            <h3
              className={`text-sm font-semibold mb-3 ${isDark ? "text-gray-300" : "text-gray-700"}`}
            >
              用户列表
            </h3>
            <div className="space-y-2">
              {users.length === 0 ? (
                <p
                  className={`text-xs p-3 rounded-lg text-center ${isDark ? "bg-gray-700/50 text-gray-400" : "bg-gray-50 text-gray-500"}`}
                >
                  暂无用户数据（细粒度用户管理可通过 CLI /permissions
                  user 配置）
                </p>
              ) : (
                users.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => setSelectedUser(user)}
                    className={`w-full text-left p-3 rounded-lg transition-colors ${
                      selectedUser?.id === user.id
                        ? isDark
                          ? "bg-blue-900/30 border border-blue-700"
                          : "bg-blue-50 border border-blue-200"
                        : isDark
                          ? "bg-gray-700/50 hover:bg-gray-700"
                          : "bg-gray-50 hover:bg-gray-100"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`font-medium ${isDark ? "text-gray-100" : "text-gray-900"}`}
                      >
                        {user.username}
                      </span>
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded ${getRoleColor(user.role)}`}
                      >
                        {user.role}
                      </span>
                    </div>
                    <p
                      className={`text-xs mt-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                    >
                      {user.email}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="flex-1">
            {selectedUser ? (
              <>
                <div
                  className={`${isDark ? "bg-gray-800" : "bg-white"} rounded-lg border ${isDark ? "border-gray-700" : "border-gray-200"} p-6 mb-6`}
                >
                  <h3
                    className={`text-lg font-semibold mb-4 ${isDark ? "text-gray-100" : "text-gray-900"}`}
                  >
                    用户详情: {selectedUser.username}
                  </h3>
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label
                        className={`block text-sm font-medium mb-2 ${isDark ? "text-gray-300" : "text-gray-700"}`}
                      >
                        信任等级
                      </label>
                      {/* M0e：信任等级由角色派生，只读展示（避免假交互，CS04） */}
                      <div
                        className={`p-3 rounded-lg border ${isDark ? "border-gray-700 bg-gray-700/50" : "border-gray-200 bg-gray-50"}`}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`font-medium ${isDark ? "text-gray-100" : "text-gray-900"}`}
                          >
                            Lv.{selectedUser.trustLevel}{" "}
                            {getTrustLevelInfo(selectedUser.trustLevel).name}
                          </span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded ${getTrustLevelColor(selectedUser.trustLevel)}`}
                          >
                            当前
                          </span>
                        </div>
                        <p
                          className={`text-xs mt-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                        >
                          {getTrustLevelInfo(selectedUser.trustLevel).description}
                        </p>
                        <p
                          className={`text-xs mt-2 ${isDark ? "text-gray-500" : "text-gray-500"}`}
                        >
                          信任等级由角色派生（admin/system=Lv.4，user=Lv.2，
                          guest=Lv.0），只读展示。
                        </p>
                      </div>
                    </div>
                    <div>
                      <label
                        className={`block text-sm font-medium mb-2 ${isDark ? "text-gray-300" : "text-gray-700"}`}
                      >
                        角色
                      </label>
                      <div className="space-y-2">
                        {(["admin", "user", "guest"] as const).map((role) => (
                          <button
                            key={role}
                            onClick={() =>
                              updateUserRole(selectedUser.id, role)
                            }
                            className={`w-full text-left p-3 rounded-lg border transition-colors ${
                              selectedUser.role === role
                                ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                                : isDark
                                  ? "border-gray-700 bg-gray-700/50 hover:bg-gray-700"
                                  : "border-gray-200 hover:bg-gray-50"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span
                                className={`font-medium ${isDark ? "text-gray-100" : "text-gray-900"}`}
                              >
                                {role === "admin"
                                  ? "管理员"
                                  : role === "user"
                                    ? "普通用户"
                                    : "访客"}
                              </span>
                              <span
                                className={`text-xs px-1.5 py-0.5 rounded ${getRoleColor(role)}`}
                              >
                                {role}
                              </span>
                            </div>
                            <p
                              className={`text-xs mt-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                            >
                              {role === "admin"
                                ? "完全系统访问权限"
                                : role === "user"
                                  ? "标准访问权限"
                                  : "受限访问权限"}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <p
                      className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
                    >
                      最后活动: {selectedUser.lastActive}
                    </p>
                  </div>
                </div>

                <div
                  className={`${isDark ? "bg-gray-800" : "bg-white"} rounded-lg border ${isDark ? "border-gray-700" : "border-gray-200"} p-6`}
                >
                  <div className="flex items-center justify-between mb-4">
                    <h3
                      className={`text-lg font-semibold ${isDark ? "text-gray-100" : "text-gray-900"}`}
                    >
                      用户权限
                    </h3>
                    <button
                      onClick={loadPermissions}
                      disabled={permissionsLoading}
                      className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 text-gray-700 dark:text-gray-300 rounded"
                    >
                      {permissionsLoading ? "加载中..." : "刷新"}
                    </button>
                  </div>
                  {permissionsLoading ? (
                    <div className="text-center py-4">
                      <span className="text-sm text-gray-400">
                        权限加载中...
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {systemPermissions.map((perm) => (
                        <div
                          key={perm.id}
                          className={`flex items-center justify-between p-3 rounded-lg ${isDark ? "bg-gray-700/50" : "bg-gray-50"}`}
                        >
                          <div>
                            <span
                              className={`font-medium ${isDark ? "text-gray-100" : "text-gray-900"}`}
                            >
                              {perm.name}
                            </span>
                            <p
                              className={`text-xs mt-0.5 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                            >
                              {perm.description}
                            </p>
                          </div>
                          <button
                            onClick={() => togglePermission(perm.id)}
                            className={`relative w-12 h-6 rounded-full transition-colors ${
                              perm.enabled
                                ? "bg-blue-600"
                                : isDark
                                  ? "bg-gray-600"
                                  : "bg-gray-300"
                            }`}
                          >
                            <span
                              className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                                perm.enabled ? "left-7" : "left-1"
                              }`}
                            />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* P1-5：工具权限规则管理（真实 API /v1/permissions/rules） */}
                <div
                  className={`${isDark ? "bg-gray-800" : "bg-white"} rounded-lg border ${isDark ? "border-gray-700" : "border-gray-200"} p-6`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3
                      className={`text-lg font-semibold ${isDark ? "text-gray-100" : "text-gray-900"}`}
                    >
                      工具权限规则
                    </h3>
                    <button
                      onClick={loadRules}
                      disabled={rulesLoading}
                      className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 text-gray-700 dark:text-gray-300 rounded"
                    >
                      {rulesLoading ? "加载中..." : "刷新"}
                    </button>
                  </div>
                  {/* P2-10：与 RuleEngine 对话行为规则区分（rule-handlers.ts 的 /v1/workspaces/:id/rules 是对话规则，与本页工具权限规则无关） */}
                  <p
                    className={`text-xs mb-4 ${isDark ? "text-gray-500" : "text-gray-500"}`}
                  >
                    工具权限规则：控制 AI 能否调用某个工具（allow/deny/ask），
                    数据存于 permissions/tool_rules.json。与"对话行为规则"
                    （RuleEngine，约束 Agent 回复行为）不是一回事，勿混用。
                  </p>

                  <div className="flex gap-3 mb-4 text-xs">
                    <span
                      className={isDark ? "text-gray-400" : "text-gray-600"}
                    >
                      总数: {rulesSummary.total}
                    </span>
                    <span className="text-green-600">
                      允许: {rulesSummary.allow}
                    </span>
                    <span className="text-red-600">
                      拒绝: {rulesSummary.deny}
                    </span>
                    <span className="text-yellow-600">
                      询问: {rulesSummary.ask}
                    </span>
                  </div>

                  {/* 影子规则（遮蔽冲突）检测提示 */}
                  {shadowDetection && shadowDetection.shadowedCount > 0 && (
                    <div
                      className={`mb-4 p-3 rounded-lg text-xs ${
                        shadowDetection.isValid
                          ? isDark
                            ? "bg-yellow-900/30 text-yellow-400"
                            : "bg-yellow-50 text-yellow-700"
                          : isDark
                            ? "bg-red-900/30 text-red-400"
                            : "bg-red-50 text-red-700"
                      }`}
                    >
                      <p className="font-medium mb-1">
                        ⚠ 规则冲突检测：{shadowDetection.shadowedCount}{" "}
                        条规则被遮蔽（规则顺序或通配导致失效）
                      </p>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {shadowDetection.suggestions.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex gap-2 mb-4">
                    <select
                      value={ruleBehavior}
                      onChange={(e) =>
                        setRuleBehavior(
                          e.target.value as "allow" | "deny" | "ask",
                        )
                      }
                      className={`px-2 py-1.5 text-xs rounded border ${isDark ? "bg-gray-700 border-gray-600 text-gray-200" : "bg-white border-gray-300 text-gray-800"}`}
                    >
                      <option value="allow">允许</option>
                      <option value="deny">拒绝</option>
                      <option value="ask">询问</option>
                    </select>
                    <input
                      placeholder="工具名（支持 glob，如 Bash）"
                      value={ruleToolName}
                      onChange={(e) => setRuleToolName(e.target.value)}
                      className={`flex-1 px-2 py-1.5 text-xs rounded border ${isDark ? "bg-gray-700 border-gray-600 text-gray-200 placeholder-gray-500" : "bg-white border-gray-300 text-gray-800 placeholder-gray-400"}`}
                    />
                    <input
                      placeholder="内容模式（可选，正则）"
                      value={ruleContentPattern}
                      onChange={(e) => setRuleContentPattern(e.target.value)}
                      className={`flex-1 px-2 py-1.5 text-xs rounded border ${isDark ? "bg-gray-700 border-gray-600 text-gray-200 placeholder-gray-500" : "bg-white border-gray-300 text-gray-800 placeholder-gray-400"}`}
                    />
                    <button
                      onClick={addRule}
                      disabled={!ruleToolName.trim()}
                      className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded"
                    >
                      添加
                    </button>
                  </div>

                  {rules.length === 0 ? (
                    <p
                      className={`text-xs p-3 rounded-lg text-center ${isDark ? "bg-gray-700/50 text-gray-400" : "bg-gray-50 text-gray-500"}`}
                    >
                      暂无权限规则。添加后，工具调用将按 allow/deny/ask
                      判定（无规则匹配时按默认行为放行或拒绝）。
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {rules.map((rule) => (
                        <div
                          key={rule.id}
                          className={`flex items-center justify-between p-3 rounded-lg ${isDark ? "bg-gray-700/50" : "bg-gray-50"}`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${
                                rule.behavior === "allow"
                                  ? isDark
                                    ? "bg-green-900/30 text-green-400"
                                    : "bg-green-100 text-green-700"
                                  : rule.behavior === "deny"
                                    ? isDark
                                      ? "bg-red-900/30 text-red-400"
                                      : "bg-red-100 text-red-700"
                                    : isDark
                                      ? "bg-yellow-900/30 text-yellow-400"
                                      : "bg-yellow-100 text-yellow-700"
                              }`}
                            >
                              {rule.behavior === "allow"
                                ? "允许"
                                : rule.behavior === "deny"
                                  ? "拒绝"
                                  : "询问"}
                            </span>
                            <span
                              className={`font-mono text-sm truncate ${isDark ? "text-gray-100" : "text-gray-900"}`}
                            >
                              {rule.toolName}
                            </span>
                            {rule.contentPattern && (
                              <span
                                className={`text-xs font-mono truncate ${isDark ? "text-gray-400" : "text-gray-500"}`}
                              >
                                {rule.contentPattern}
                              </span>
                            )}
                          </div>
                          <button
                            onClick={() => deleteRule(rule.id)}
                            className="text-xs text-red-500 hover:text-red-400 shrink-0 ml-2"
                          >
                            删除
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div
                className={`${isDark ? "bg-gray-800" : "bg-white"} rounded-lg border ${isDark ? "border-gray-700" : "border-gray-200"} p-6 text-center`}
              >
                <p
                  className={`${isDark ? "text-gray-500" : "text-gray-400"}`}
                >
                  暂无用户数据：细粒度用户管理可通过 CLI /permissions user 配置后，在此查看信任等级与角色。
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default PermissionPage;
