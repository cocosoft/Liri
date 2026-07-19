import { useState, useEffect } from "react";
import { useConfigStore } from "../../stores/configStore";
import { authService, type Permission } from "../../services/authService";
import { createLogger } from "@/utils/logger";

const logger = createLogger("components:permission");

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
  const [users, setUsers] = useState<UserPermission[]>([
    {
      id: "1",
      username: "admin",
      email: "admin@example.com",
      role: "admin",
      trustLevel: 4,
      permissions: ["all"],
      lastActive: "2026-05-28 12:00",
    },
    {
      id: "2",
      username: "user1",
      email: "user1@example.com",
      role: "user",
      trustLevel: 2,
      permissions: ["read", "write", "execute"],
      lastActive: "2026-05-28 11:30",
    },
    {
      id: "3",
      username: "guest",
      email: "guest@example.com",
      role: "guest",
      trustLevel: 0,
      permissions: ["read"],
      lastActive: "2026-05-28 10:00",
    },
  ]);
  const [selectedUser, setSelectedUser] = useState<UserPermission | null>(null);
  const [systemPermissions, setSystemPermissions] = useState<PermissionItem[]>(
    [],
  );
  const [permissionsLoading, setPermissionsLoading] = useState(true);

  useEffect(() => {
    loadConfig();
    loadPermissions();
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
      logger.error("加载权限失败，使用默认配置", e);
      setSystemPermissions([
        {
          id: "network",
          name: "网络访问",
          description: "允许访问外部网络",
          enabled: true,
        },
        {
          id: "filesystem",
          name: "文件系统",
          description: "允许读写本地文件",
          enabled: true,
        },
        {
          id: "execute",
          name: "代码执行",
          description: "允许执行动态代码",
          enabled: false,
        },
        {
          id: "memory",
          name: "内存访问",
          description: "允许访问系统内存",
          enabled: false,
        },
        {
          id: "process",
          name: "进程管理",
          description: "允许创建和管理进程",
          enabled: false,
        },
        {
          id: "admin",
          name: "管理员权限",
          description: "允许系统级操作",
          enabled: false,
        },
      ]);
    } finally {
      setPermissionsLoading(false);
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

  const updateUserTrustLevel = (userId: string, level: number) => {
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, trustLevel: level } : u)),
    );
    if (selectedUser?.id === userId) {
      setSelectedUser((prev) => (prev ? { ...prev, trustLevel: level } : null));
    }
  };

  const updateUserRole = (userId: string, role: "admin" | "user" | "guest") => {
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)));
    if (selectedUser?.id === userId) {
      setSelectedUser((prev) => (prev ? { ...prev, role } : null));
    }
  };

  return (
    <div
      className={`flex-1 overflow-y-auto ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
    >
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1
              className={`text-2xl font-bold ${isDark ? "text-gray-100" : "text-gray-900"}`}
            >
              权限管理
            </h1>
            <p
              className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              管理用户信任等级和系统权限
            </p>
          </div>
        </div>

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
              {users.map((user) => (
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
              ))}
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
                      <div className="space-y-2">
                        {TRUST_LEVELS.map((level) => (
                          <button
                            key={level.level}
                            onClick={() =>
                              updateUserTrustLevel(selectedUser.id, level.level)
                            }
                            className={`w-full text-left p-3 rounded-lg border transition-colors ${
                              selectedUser.trustLevel === level.level
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
                                Lv.{level.level} {level.name}
                              </span>
                              <span
                                className={`text-xs px-2 py-0.5 rounded ${getTrustLevelColor(level.level)}`}
                              >
                                {level.level === selectedUser.trustLevel
                                  ? "当前"
                                  : "选择"}
                              </span>
                            </div>
                            <p
                              className={`text-xs mt-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                            >
                              {level.description}
                            </p>
                          </button>
                        ))}
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
              </>
            ) : (
              <div
                className={`${isDark ? "bg-gray-800" : "bg-white"} rounded-lg border ${isDark ? "border-gray-700" : "border-gray-200"} p-6 text-center`}
              >
                <p
                  className={`text-gray-400 ${isDark ? "text-gray-500" : "text-gray-400"}`}
                >
                  请从左侧选择一个用户查看详情
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
