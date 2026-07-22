/**
 * 理事会 Agent 角色管理页面
 *
 * 管理 Council 功能的 5 个专家 Agent 角色：
 * 架构师、安全专家、性能专家、前端专家、后端专家
 * 支持新增、编辑、删除、启用/禁用操作，数据持久化到数据库。
 */

import { useState, useEffect, useCallback } from "react";
import { useConfigStore } from "../../stores/configStore";
import { httpLegacy as http } from "../../services/httpClient";

// ========== 类型定义 ==========

interface AgentRole {
  id?: string;
  agentId: string;
  name: string;
  expertise: string[];
  weight: number;
  systemPrompt: string;
  icon: string;
  sortOrder: number;
  enabled: boolean;
}

interface FormData {
  agentId: string;
  name: string;
  expertise: string;
  weight: number;
  systemPrompt: string;
  icon: string;
  sortOrder: number;
  enabled: boolean;
}

// ========== 空表单 ==========

const EMPTY_FORM: FormData = {
  agentId: "",
  name: "",
  expertise: "",
  weight: 1.0,
  systemPrompt: "",
  icon: "🤖",
  sortOrder: 0,
  enabled: true,
};

// ========== 组件 ==========

function CouncilAgentRolesPage() {
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";

  const [roles, setRoles] = useState<AgentRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 对话框状态
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<AgentRole | null>(null);
  const [deleting, setDeleting] = useState(false);

  /** 加载角色列表 */
  const loadRoles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await http.get<AgentRole[]>("/v1/agent-roles");
      setRoles(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRoles();
  }, [loadRoles]);

  /** 打开新增对话框 */
  const handleAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  };

  /** 打开编辑对话框 */
  const handleEdit = (role: AgentRole) => {
    setEditingId(role.agentId);
    setForm({
      agentId: role.agentId,
      name: role.name,
      expertise: role.expertise.join(", "),
      weight: role.weight,
      systemPrompt: role.systemPrompt,
      icon: role.icon,
      sortOrder: role.sortOrder,
      enabled: role.enabled,
    });
    setFormError(null);
    setShowForm(true);
  };

  /** 保存（新增/更新） */
  const handleSave = async () => {
    if (!form.name.trim()) {
      setFormError("角色名称不能为空");
      return;
    }
    if (!form.agentId.trim()) {
      setFormError("Agent 标识不能为空");
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      const expertiseList = form.expertise
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const payload = {
        agentId: form.agentId.trim(),
        name: form.name.trim(),
        expertise: expertiseList,
        weight: form.weight,
        systemPrompt: form.systemPrompt,
        icon: form.icon,
        sortOrder: form.sortOrder,
        enabled: form.enabled,
      };

      if (editingId) {
        await http.put(`/v1/agent-roles/${editingId}`, payload);
      } else {
        await http.post("/v1/agent-roles", payload);
      }

      setShowForm(false);
      await loadRoles();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  /** 删除角色 */
  const handleDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    setDeleting(true);
    try {
      await http.delete(`/v1/agent-roles/${deleteTarget.agentId}`);
      setDeleteTarget(null);
      await loadRoles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  };

  /** 切换启用/禁用 */
  const handleToggleEnabled = async (role: AgentRole) => {
    try {
      await http.put(`/v1/agent-roles/${role.agentId}`, {
        enabled: !role.enabled,
      });
      await loadRoles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    }
  };

  // ========== 渲染 ==========

  return (
    <div
      className={`flex-1 overflow-y-auto ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
    >
      <div className="max-w-5xl mx-auto p-6">
        {/* 页头 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2
              className={`text-2xl font-bold ${isDark ? "text-gray-100" : "text-gray-900"}`}
            >
              理事会专家角色管理
            </h2>
            <p
              className={`mt-1 text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              管理 Agent Council
              辩论的专家角色，支持新增、编辑、删除和启用/禁用。 默认包含 5
              个专家角色（架构师、安全专家、性能专家、前端专家、后端专家）。
            </p>
          </div>
          <button
            onClick={handleAdd}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors"
          >
            + 新增角色
          </button>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-400">
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-2 underline hover:no-underline"
            >
              关闭
            </button>
          </div>
        )}

        {/* 加载中 */}
        {loading && (
          <div
            className={`text-center py-12 text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            加载中...
          </div>
        )}

        {/* 角色列表 */}
        {!loading && roles.length === 0 && (
          <div
            className={`text-center py-12 text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            暂无 Agent 角色，请点击"新增角色"添加。
          </div>
        )}

        {!loading && roles.length > 0 && (
          <div className="space-y-3">
            {roles.map((role) => (
              <div
                key={role.agentId}
                className={`rounded-lg border p-4 transition-colors ${
                  isDark
                    ? "bg-gray-800 border-gray-700 hover:border-gray-600"
                    : "bg-white border-gray-200 hover:border-gray-300"
                } ${!role.enabled ? "opacity-60" : ""}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{role.icon}</span>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3
                          className={`text-base font-semibold ${isDark ? "text-gray-100" : "text-gray-900"}`}
                        >
                          {role.name}
                        </h3>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded ${
                            isDark
                              ? "bg-gray-700 text-gray-400"
                              : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {role.agentId}
                        </span>
                        {!role.enabled && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400">
                            已禁用
                          </span>
                        )}
                      </div>

                      {/* 专业领域标签 */}
                      <div className="flex flex-wrap gap-1 mb-1">
                        {role.expertise.map((exp, i) => (
                          <span
                            key={i}
                            className={`text-xs px-1.5 py-0.5 rounded ${
                              isDark
                                ? "bg-blue-900/40 text-blue-300"
                                : "bg-blue-50 text-blue-600"
                            }`}
                          >
                            {exp}
                          </span>
                        ))}
                      </div>

                      {/* 权重 */}
                      <div
                        className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                      >
                        权重: {role.weight} | 排序: {role.sortOrder}
                      </div>
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => handleToggleEnabled(role)}
                      className={`px-2 py-1 text-xs rounded transition-colors ${
                        role.enabled
                          ? isDark
                            ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                          : "bg-green-600 text-white hover:bg-green-700"
                      }`}
                      title={role.enabled ? "禁用" : "启用"}
                    >
                      {role.enabled ? "禁用" : "启用"}
                    </button>
                    <button
                      onClick={() => handleEdit(role)}
                      className={`px-2 py-1 text-xs rounded transition-colors ${
                        isDark
                          ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => setDeleteTarget(role)}
                      className="px-2 py-1 text-xs rounded bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* System Prompt 区域（折叠展示） */}
        {!loading && roles.length > 0 && (
          <div className="mt-6">
            <h3
              className={`text-sm font-semibold mb-2 ${isDark ? "text-gray-300" : "text-gray-700"}`}
            >
              System Prompt 预览
            </h3>
            <div className="space-y-2">
              {roles.map((role) => (
                <details key={role.agentId} className="group">
                  <summary
                    className={`text-xs cursor-pointer px-3 py-1.5 rounded ${
                      isDark
                        ? "bg-gray-800 text-gray-300 hover:bg-gray-700"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {role.icon} {role.name} — System Prompt
                  </summary>
                  <pre
                    className={`mt-1 px-3 py-2 text-xs rounded overflow-x-auto ${
                      isDark
                        ? "bg-gray-850 text-gray-400"
                        : "bg-gray-50 text-gray-500"
                    }`}
                    style={{ whiteSpace: "pre-wrap" }}
                  >
                    {role.systemPrompt || "(无)"}
                  </pre>
                </details>
              ))}
            </div>
          </div>
        )}

        {/* 新增/编辑对话框 */}
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div
              className={`w-full max-w-lg mx-4 rounded-lg shadow-xl ${
                isDark ? "bg-gray-800" : "bg-white"
              }`}
            >
              <div
                className={`px-6 py-4 border-b ${isDark ? "border-gray-700" : "border-gray-200"}`}
              >
                <h3
                  className={`text-lg font-semibold ${isDark ? "text-gray-100" : "text-gray-900"}`}
                >
                  {editingId ? "编辑角色" : "新增角色"}
                </h3>
              </div>

              <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
                {/* 表单错误 */}
                {formError && (
                  <div className="px-3 py-2 bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-400">
                    {formError}
                  </div>
                )}

                {/* Agent 标识 */}
                <div>
                  <label
                    className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
                  >
                    Agent 标识 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.agentId}
                    onChange={(e) =>
                      setForm({ ...form, agentId: e.target.value })
                    }
                    disabled={!!editingId}
                    className={`w-full px-3 py-2 text-sm rounded border ${
                      isDark
                        ? "bg-gray-700 border-gray-600 text-gray-200"
                        : "bg-white border-gray-300 text-gray-900"
                    } ${editingId ? "opacity-50 cursor-not-allowed" : ""}`}
                    placeholder="如：architect"
                  />
                  {editingId && (
                    <p className="text-xs text-gray-400 mt-1">创建后不可修改</p>
                  )}
                </div>

                {/* 角色名称 */}
                <div>
                  <label
                    className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
                  >
                    角色名称 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className={`w-full px-3 py-2 text-sm rounded border ${
                      isDark
                        ? "bg-gray-700 border-gray-600 text-gray-200"
                        : "bg-white border-gray-300 text-gray-900"
                    }`}
                    placeholder="如：架构师"
                  />
                </div>

                {/* 图标 */}
                <div>
                  <label
                    className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
                  >
                    图标 emoji
                  </label>
                  <input
                    type="text"
                    value={form.icon}
                    onChange={(e) => setForm({ ...form, icon: e.target.value })}
                    className={`w-full px-3 py-2 text-sm rounded border ${
                      isDark
                        ? "bg-gray-700 border-gray-600 text-gray-200"
                        : "bg-white border-gray-300 text-gray-900"
                    }`}
                    placeholder="如：🏗️"
                    maxLength={4}
                  />
                </div>

                {/* 专业领域 */}
                <div>
                  <label
                    className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
                  >
                    专业领域（逗号分隔）
                  </label>
                  <input
                    type="text"
                    value={form.expertise}
                    onChange={(e) =>
                      setForm({ ...form, expertise: e.target.value })
                    }
                    className={`w-full px-3 py-2 text-sm rounded border ${
                      isDark
                        ? "bg-gray-700 border-gray-600 text-gray-200"
                        : "bg-white border-gray-300 text-gray-900"
                    }`}
                    placeholder="如：系统架构, 模块设计, 扩展性"
                  />
                </div>

                {/* 权重和排序 */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label
                      className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
                    >
                      权重
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      value={form.weight}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          weight: parseFloat(e.target.value) || 0,
                        })
                      }
                      className={`w-full px-3 py-2 text-sm rounded border ${
                        isDark
                          ? "bg-gray-700 border-gray-600 text-gray-200"
                          : "bg-white border-gray-300 text-gray-900"
                      }`}
                    />
                  </div>
                  <div>
                    <label
                      className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
                    >
                      排序
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={form.sortOrder}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          sortOrder: parseInt(e.target.value) || 0,
                        })
                      }
                      className={`w-full px-3 py-2 text-sm rounded border ${
                        isDark
                          ? "bg-gray-700 border-gray-600 text-gray-200"
                          : "bg-white border-gray-300 text-gray-900"
                      }`}
                    />
                  </div>
                </div>

                {/* 启用 */}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="enabled"
                    checked={form.enabled}
                    onChange={(e) =>
                      setForm({ ...form, enabled: e.target.checked })
                    }
                    className="rounded"
                  />
                  <label
                    htmlFor="enabled"
                    className={`text-sm ${isDark ? "text-gray-300" : "text-gray-700"}`}
                  >
                    启用
                  </label>
                </div>

                {/* System Prompt */}
                <div>
                  <label
                    className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
                  >
                    System Prompt
                  </label>
                  <textarea
                    value={form.systemPrompt}
                    onChange={(e) =>
                      setForm({ ...form, systemPrompt: e.target.value })
                    }
                    rows={8}
                    className={`w-full px-3 py-2 text-sm rounded border font-mono ${
                      isDark
                        ? "bg-gray-700 border-gray-600 text-gray-200"
                        : "bg-white border-gray-300 text-gray-900"
                    }`}
                    placeholder="输入 Agent 的 system prompt 模板..."
                  />
                </div>
              </div>

              {/* 对话框底部按钮 */}
              <div
                className={`px-6 py-3 border-t flex justify-end gap-2 ${isDark ? "border-gray-700" : "border-gray-200"}`}
              >
                <button
                  onClick={() => setShowForm(false)}
                  className={`px-4 py-2 text-sm rounded transition-colors ${
                    isDark
                      ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
                >
                  {saving ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 删除确认对话框 */}
        {deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div
              className={`w-full max-w-sm mx-4 rounded-lg shadow-xl p-6 ${
                isDark ? "bg-gray-800" : "bg-white"
              }`}
            >
              <h3
                className={`text-base font-semibold mb-2 ${isDark ? "text-gray-100" : "text-gray-900"}`}
              >
                确认删除
              </h3>
              <p
                className={`text-sm mb-4 ${isDark ? "text-gray-400" : "text-gray-600"}`}
              >
                确定要删除角色 "<strong>{deleteTarget.name}</strong> (
                {deleteTarget.agentId})"吗？ 此操作不可恢复。
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className={`px-4 py-2 text-sm rounded transition-colors ${
                    isDark
                      ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  取消
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-4 py-2 text-sm rounded bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50"
                >
                  {deleting ? "删除中..." : "确认删除"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CouncilAgentRolesPage;
