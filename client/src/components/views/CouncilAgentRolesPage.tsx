/**
 * Agent 角色管理页（`/agent/roles`）—— Liri **全局 Agent 角色**的管理面（设计文档 T1 所有权归一）。
 *
 * 数据源：`agent_roles` 表（单一事实来源）。两个消费者共用同一份配置：
 * ① 理事会辩论（`CouncilOrchestrator`）；② 子代理描述符解析链（`AgentTool` 的 `subagent_type`）。
 *
 * 能力：新增 / 编辑 / 删除 / 启用禁用；`model` = 该角色的**推荐模型**（留空 ⇒ 沿用任务分工默认模型）。
 * 默认包含 5 个专家角色（架构师、安全专家、性能专家、前端专家、后端专家）。
 */

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";
import { httpLegacy as http } from "../../services/httpClient";
import { modelService, type ModelInfo } from "../../services/modelService";
import { AgentRuntimePanel } from "./agent-runtime/AgentRuntimePanel";

// ========== 类型定义 ==========

interface AgentRole {
  id?: string;
  agentId: string;
  name: string;
  expertise: string[];
  weight: number;
  systemPrompt: string;
  /** T5：推荐模型（**模型名** = `ModelInfo.modelId`，下游 `getByModel()` 的口径；空 = 沿用任务分工默认模型） */
  model?: string;
  /** T9：该角色能否再委派子代理（策略位；缺省 = 不可委派） */
  canDelegate?: boolean;
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
  /** T5：空字符串 = 未指定（提交时原样发送 ⇒ 后端存空值 = 沿用默认） */
  model: string;
  /** T9：授权位（提交布尔值；后端仅在显式布尔时改写） */
  canDelegate: boolean;
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
  model: "",
  canDelegate: false,
  icon: "🤖",
  sortOrder: 0,
  enabled: true,
};

// 运行态面板（T8）已抽离至 `./agent-runtime/AgentRuntimePanel`
// （该页因它由 624 行增至 906 行、突破 lint:size 的 800 行阈值，故拆分）

// ========== 组件 ==========

function CouncilAgentRolesPage() {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";

  const [roles, setRoles] = useState<AgentRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** T5：可选模型（来自 `/v1/models`，与模型管理页同源；仅**启用的** chat 模型） */
  const [models, setModels] = useState<ModelInfo[]>([]);

  // 运行态（T8）相关状态已随面板抽离

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
      setError(err instanceof Error ? err.message : t("council.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRoles();
  }, [loadRoles]);

  /** T5：加载模型选项（失败 ⇒ 下拉仅剩「沿用默认」项，不阻断角色管理） */
  useEffect(() => {
    modelService
      .list()
      .then((all) =>
        // 只列**启用**的 chat 模型：与后端校验口径一致
        // （`activeModelService.isModelAvailable()` 只认"存在且 enabled"的模型名）
        setModels(all.filter((m) => m.type === "chat" && m.enabled !== false)),
      )
      .catch(() => setModels([]));
  }, []);

  // 运行态加载逻辑已随面板抽离（`AgentRuntimePanel` 自行 fetch）

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
      model: role.model ?? "",
      canDelegate: role.canDelegate === true,
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
      setFormError(t("council.nameRequired"));
      return;
    }
    if (!form.agentId.trim()) {
      setFormError(t("council.agentIdRequired"));
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
        // T5：空字符串 = 未指定（后端 `agent_roles.model` 可为空 ⇒ 解析链回落到任务分工默认模型）
        model: form.model,
        // T9：授权位（显式布尔值；模型无法自选，只能由用户在此设置）
        canDelegate: form.canDelegate,
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
      setFormError(
        err instanceof Error ? err.message : t("council.saveFailed"),
      );
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
      setError(err instanceof Error ? err.message : t("council.deleteFailed"));
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
      setError(
        err instanceof Error ? err.message : t("council.operationFailed"),
      );
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
              {t("workspace.agentRoles")}
            </h2>
            <p
              className={`mt-1 text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              {t("workspace.agentRolesDesc")}
            </p>
          </div>
          <button
            onClick={handleAdd}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors"
          >
            + {t("council.addRole")}
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
              {t("common.close")}
            </button>
          </div>
        )}

        {/* 加载中 */}
        {loading && (
          <div
            className={`text-center py-12 text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            {t("common.loading")}
          </div>
        )}

        {/* 角色列表 */}
        {!loading && roles.length === 0 && (
          <div
            className={`text-center py-12 text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            {t("council.empty")}
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
                            {t("common.disabled")}
                          </span>
                        )}
                        {role.canDelegate && (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                            title={t("council.delegateTooltip")}
                          >
                            {t("council.delegatable")}
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

                      {/* 权重 / 排序 / 推荐模型（T5：后端已贯通，此处回显） */}
                      <div
                        className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                      >
                        {t("council.metaLine", {
                          weight: role.weight,
                          sortOrder: role.sortOrder,
                          model: role.model
                            ? (models.find((m) => m.modelId === role.model)
                                ?.name ?? role.model)
                            : t("council.modelDefault"),
                        })}
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
                      title={
                        role.enabled ? t("common.disable") : t("common.enable")
                      }
                    >
                      {role.enabled ? t("common.disable") : t("common.enable")}
                    </button>
                    <button
                      onClick={() => handleEdit(role)}
                      className={`px-2 py-1 text-xs rounded transition-colors ${
                        isDark
                          ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {t("common.edit")}
                    </button>
                    <button
                      onClick={() => setDeleteTarget(role)}
                      className="px-2 py-1 text-xs rounded bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                    >
                      {t("common.delete")}
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
              {t("council.systemPromptPreview")}
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
                    {role.systemPrompt || t("council.systemPromptEmpty")}
                  </pre>
                </details>
              ))}
            </div>
          </div>
        )}

        {/* 运行态 / 最近运行（T8）：已抽离为独立组件（`./agent-runtime/AgentRuntimePanel`） */}
        <AgentRuntimePanel isDark={isDark} />

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
                  {editingId ? t("council.editRole") : t("council.addRole")}
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
                    {t("council.agentIdLabel")}{" "}
                    <span className="text-red-500">*</span>
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
                    placeholder={t("council.agentIdPlaceholder")}
                  />
                  {editingId && (
                    <p className="text-xs text-gray-400 mt-1">
                      {t("council.agentIdHint")}
                    </p>
                  )}
                </div>

                {/* 角色名称 */}
                <div>
                  <label
                    className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
                  >
                    {t("council.roleName")}{" "}
                    <span className="text-red-500">*</span>
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
                    placeholder={t("council.roleNamePlaceholder")}
                  />
                </div>

                {/* 图标 */}
                <div>
                  <label
                    className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
                  >
                    {t("council.iconLabel")}
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
                    placeholder={t("council.iconPlaceholder")}
                    maxLength={4}
                  />
                </div>

                {/* 专业领域 */}
                <div>
                  <label
                    className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
                  >
                    {t("council.expertiseLabel")}
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
                    placeholder={t("council.expertisePlaceholder")}
                  />
                </div>

                {/* 推荐模型（T5：取值来自 /v1/models，与模型管理页同源） */}
                <div>
                  <label
                    className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
                  >
                    {t("council.recommendedModel")}
                  </label>
                  <select
                    value={form.model}
                    onChange={(e) =>
                      setForm({ ...form, model: e.target.value })
                    }
                    className={`w-full px-3 py-2 text-sm rounded border ${
                      isDark
                        ? "bg-gray-700 border-gray-600 text-gray-200"
                        : "bg-white border-gray-300 text-gray-900"
                    }`}
                  >
                    <option value="">{t("council.modelInherit")}</option>
                    {models.map((m) => (
                      // ⚠ 值必须是**模型名**（`modelId`）：下游 `providerRegistry.getByModel()`
                      // 按模型名解析，传 UUID（`id`）会解析不到、并把 UUID 当模型名发给上游
                      // （表现为 400 "unsupported model" —— 与本项目台账 N-27 同类）
                      <option key={m.id} value={m.modelId}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <p
                    className={`text-xs mt-1 ${isDark ? "text-gray-500" : "text-gray-400"}`}
                  >
                    {t("council.modelHint")}
                  </p>
                </div>

                {/* 权重和排序 */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label
                      className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
                    >
                      {t("council.weight")}
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
                      {t("council.sortOrder")}
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
                    {t("common.enable")}
                  </label>
                </div>

                {/* T9：授权位（能否再委派子代理） */}
                <div
                  className={`rounded border p-3 ${isDark ? "border-gray-700" : "border-gray-200"}`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="canDelegate"
                      checked={form.canDelegate}
                      onChange={(e) =>
                        setForm({ ...form, canDelegate: e.target.checked })
                      }
                      className="rounded"
                    />
                    <label
                      htmlFor="canDelegate"
                      className={`text-sm ${isDark ? "text-gray-300" : "text-gray-700"}`}
                    >
                      {t("council.allowDelegate")}
                    </label>
                  </div>
                  <p
                    className={`text-xs mt-1 ${isDark ? "text-gray-500" : "text-gray-400"}`}
                  >
                    {t("council.allowDelegateHint")}
                  </p>
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
                    placeholder={t("council.systemPromptPlaceholder")}
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
                  {t("common.cancel")}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
                >
                  {saving ? t("council.saving") : t("common.save")}
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
                {t("council.confirmDelete")}
              </h3>
              <p
                className={`text-sm mb-4 ${isDark ? "text-gray-400" : "text-gray-600"}`}
              >
                {t("council.deleteConfirmPrefix")}
                <strong>{deleteTarget.name}</strong> ({deleteTarget.agentId})
                {t("council.deleteConfirmSuffix")}
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
                  {t("common.cancel")}
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-4 py-2 text-sm rounded bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50"
                >
                  {deleting
                    ? t("council.deleting")
                    : t("council.confirmDelete")}
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
