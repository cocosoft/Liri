import { useState, useEffect, useCallback } from "react";
import { useConfigStore } from "../../stores/configStore";
import type {
  InstalledMCPServer,
  MCPTransport,
} from "../../services/mcpMarketplaceService";

// ─── 配置数据类型 ─────────────────────────────────────

export interface MCPConfigData {
  title: string;
  description: string;
  transport: MCPTransport;
  url: string;
  command: string;
  args: string;
  authType: "none" | "bearer";
  apiKey: string;
  headers: string;
  envVars: Array<{ name: string; value: string }>;
}

// ─── 从已安装服务器提取初始配置 ──────────────────────

function initialConfigFrom(server?: InstalledMCPServer): MCPConfigData {
  if (!server) {
    return {
      title: "",
      description: "",
      transport: "http",
      url: "",
      command: "",
      args: "",
      authType: "none",
      apiKey: "",
      headers: "",
      envVars: [{ name: "", value: "" }],
    };
  }

  return {
    title: server.title || server.name,
    description: "",
    transport: server.transport || "http",
    url: "",
    command: "",
    args: "",
    authType: "none",
    apiKey: "",
    headers: "",
    envVars: [{ name: "", value: "" }],
  };
}

// ─── Props ────────────────────────────────────────────

interface MCPConfigModalProps {
  /** 编辑模式下传入已有服务器，新建模式为 null */
  server: InstalledMCPServer | null;
  /** 是否显示 */
  show: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 保存回调 */
  onSave: (data: MCPConfigData) => void;
  /** 导出回调 */
  onExport: (data: MCPConfigData) => void;
  /** 验证连接回调 */
  onVerify?: () => void;
  /** 是否正在验证 */
  verifying?: boolean;
}

const AUTH_OPTIONS = [
  { value: "none", label: "无" },
  { value: "bearer", label: "Bearer Token" },
];

/**
 * MCPConfigModal — MCP 服务器配置编辑弹窗
 * 支持：名称/URL/传输类型/认证/Headers/环境变量/高级折叠
 */
function MCPConfigModal({
  server,
  show,
  onClose,
  onSave,
  onExport,
  onVerify,
  verifying = false,
}: MCPConfigModalProps) {
  const { config } = useConfigStore();
  const isDark = config.theme === "dark";
  const isEdit = !!server;

  const [form, setForm] = useState<MCPConfigData>(() =>
    initialConfigFrom(server ?? undefined),
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  // 当 server 变化时重置表单
  useEffect(() => {
    if (show) {
      setForm(initialConfigFrom(server ?? undefined));
      setShowAdvanced(false);
    }
  }, [show, server]);

  // ESC 关闭
  useEffect(() => {
    if (!show) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [show, onClose]);

  const update = useCallback(
    (partial: Partial<MCPConfigData>) =>
      setForm((prev) => ({ ...prev, ...partial })),
    [],
  );

  // 更新单个环境变量
  const updateEnvVar = useCallback(
    (index: number, field: "name" | "value", val: string) => {
      setForm((prev) => {
        const envVars = prev.envVars.map((ev, i) =>
          i === index ? { ...ev, [field]: val } : ev,
        );
        return { ...prev, envVars };
      });
    },
    [],
  );

  // 添加环境变量行
  const addEnvVar = useCallback(() => {
    setForm((prev) => ({
      ...prev,
      envVars: [...prev.envVars, { name: "", value: "" }],
    }));
  }, []);

  // 移除环境变量行
  const removeEnvVar = useCallback((index: number) => {
    setForm((prev) => {
      const envVars = prev.envVars.filter((_, i) => i !== index);
      return {
        ...prev,
        envVars: envVars.length === 0 ? [{ name: "", value: "" }] : envVars,
      };
    });
  }, []);

  // 导入 JSON
  const handleImport = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = JSON.parse(
            event.target?.result as string,
          ) as MCPConfigData;
          if (data && typeof data === "object") {
            setForm({
              title: data.title || "",
              description: data.description || "",
              transport: data.transport || "http",
              url: data.url || "",
              command: data.command || "",
              args: data.args || "",
              authType: data.authType || "none",
              apiKey: data.apiKey || "",
              headers: data.headers || "",
              envVars:
                Array.isArray(data.envVars) && data.envVars.length > 0
                  ? data.envVars
                  : [{ name: "", value: "" }],
            });
          }
        } catch {
          // 格式错误，静默忽略
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, []);

  // 导出 JSON
  const handleExport = useCallback(() => {
    const json = JSON.stringify(form, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mcp-config-${form.title || "server"}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onExport(form);
  }, [form, onExport]);

  // 保存
  const handleSave = useCallback(() => {
    onSave(form);
  }, [form, onSave]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className={`relative w-full max-w-lg mx-4 rounded-lg shadow-xl border max-h-[90vh] flex flex-col ${
          isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
        }`}
      >
        {/* 标题栏 */}
        <div
          className={`px-5 py-3 flex items-center justify-between border-b shrink-0 ${isDark ? "border-gray-700" : "border-gray-200"}`}
        >
          <h2
            className={`text-lg font-semibold ${isDark ? "text-gray-100" : "text-gray-900"}`}
          >
            {isEdit ? "编辑配置" : "添加 MCP 服务器"}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleImport}
              className={`text-xs hover:underline ${isDark ? "text-gray-400 hover:text-gray-200" : "text-gray-500 hover:text-gray-700"}`}
              title="从 JSON 文件导入"
            >
              导入
            </button>
            <button
              onClick={handleExport}
              className={`text-xs hover:underline ${isDark ? "text-gray-400 hover:text-gray-200" : "text-gray-500 hover:text-gray-700"}`}
              title="导出为 JSON 文件"
            >
              导出
            </button>
            <button
              onClick={onClose}
              className={`p-1 rounded-lg transition-colors ${isDark ? "hover:bg-gray-700 text-gray-400" : "hover:bg-gray-100 text-gray-500"}`}
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* 表单内容 */}
        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          {/* 名称 */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label
                className={`block text-xs mb-0.5 ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                名称
              </label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => update({ title: e.target.value })}
                placeholder="输入服务器名称"
                className={`w-full text-sm bg-transparent outline-none border-b pb-1 ${
                  isDark
                    ? "border-gray-600 text-white placeholder-gray-500 focus:border-blue-400"
                    : "border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500"
                }`}
              />
            </div>
            <div className="w-28">
              <label
                className={`block text-xs mb-0.5 ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                传输类型
              </label>
              <select
                value={form.transport}
                onChange={(e) =>
                  update({ transport: e.target.value as MCPTransport })
                }
                className={`w-full text-sm bg-transparent outline-none border-b pb-1 ${
                  isDark
                    ? "border-gray-600 text-white focus:border-blue-400"
                    : "border-gray-300 text-gray-900 focus:border-blue-500"
                }`}
              >
                <option value="http">HTTP</option>
                <option value="stdio">stdio</option>
              </select>
            </div>
          </div>

          {/* 描述 */}
          <div>
            <label
              className={`block text-xs mb-0.5 ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              描述
            </label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="简要描述该服务器用途"
              className={`w-full text-sm bg-transparent outline-none border-b pb-1 ${
                isDark
                  ? "border-gray-600 text-white placeholder-gray-500 focus:border-blue-400"
                  : "border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500"
              }`}
            />
          </div>

          {/* URL / Command */}
          {form.transport === "http" ? (
            <div>
              <label
                className={`block text-xs mb-0.5 ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                URL
              </label>
              <input
                type="text"
                value={form.url}
                onChange={(e) => update({ url: e.target.value })}
                placeholder="http://localhost:8080/mcp"
                className={`w-full text-sm bg-transparent outline-none border-b pb-1 ${
                  isDark
                    ? "border-gray-600 text-white placeholder-gray-500 focus:border-blue-400"
                    : "border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500"
                }`}
              />
            </div>
          ) : (
            <div className="flex gap-3">
              <div className="flex-1">
                <label
                  className={`block text-xs mb-0.5 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  命令
                </label>
                <input
                  type="text"
                  value={form.command}
                  onChange={(e) => update({ command: e.target.value })}
                  placeholder="npx -y @company/mcp-server"
                  className={`w-full text-sm bg-transparent outline-none border-b pb-1 ${
                    isDark
                      ? "border-gray-600 text-white placeholder-gray-500 focus:border-blue-400"
                      : "border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500"
                  }`}
                />
              </div>
              <div className="flex-1">
                <label
                  className={`block text-xs mb-0.5 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  参数
                </label>
                <input
                  type="text"
                  value={form.args}
                  onChange={(e) => update({ args: e.target.value })}
                  placeholder="--port 8080 --debug"
                  className={`w-full text-sm bg-transparent outline-none border-b pb-1 ${
                    isDark
                      ? "border-gray-600 text-white placeholder-gray-500 focus:border-blue-400"
                      : "border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500"
                  }`}
                />
              </div>
            </div>
          )}

          {/* 认证方式 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                认证方式
              </label>
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className={`flex items-center gap-1 text-xs transition-colors ${
                  isDark
                    ? "text-gray-400 hover:text-gray-200"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <svg
                  className={`w-3 h-3 transition-transform ${showAdvanced ? "rotate-90" : ""}`}
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                    clipRule="evenodd"
                  />
                </svg>
                高级
              </button>
            </div>
            <select
              value={form.authType}
              onChange={(e) =>
                update({ authType: e.target.value as "none" | "bearer" })
              }
              className={`w-full text-sm bg-transparent outline-none border-b pb-1 ${
                isDark
                  ? "border-gray-600 text-white focus:border-blue-400"
                  : "border-gray-300 text-gray-900 focus:border-blue-500"
              }`}
            >
              {AUTH_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* API Key（仅 Bearer 模式下显示） */}
          {form.authType === "bearer" && (
            <div>
              <label
                className={`block text-xs mb-0.5 ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                API Key
              </label>
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) => update({ apiKey: e.target.value })}
                placeholder="sk-..."
                className={`w-full text-sm bg-transparent outline-none border-b pb-1 ${
                  isDark
                    ? "border-gray-600 text-white placeholder-gray-500 focus:border-blue-400"
                    : "border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500"
                }`}
              />
            </div>
          )}

          {/* 高级配置（折叠） */}
          {showAdvanced && (
            <div className="space-y-4 pt-2 border-t border-dashed border-gray-200 dark:border-gray-700">
              {/* Headers */}
              <div>
                <label
                  className={`block text-xs mb-0.5 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  Headers（JSON 格式）
                </label>
                <textarea
                  value={form.headers}
                  onChange={(e) => update({ headers: e.target.value })}
                  placeholder='{"X-Custom": "value"}'
                  rows={3}
                  className={`w-full text-sm bg-transparent outline-none border rounded px-2 py-1 resize-none ${
                    isDark
                      ? "border-gray-600 text-white placeholder-gray-500 focus:border-blue-400"
                      : "border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500"
                  }`}
                />
              </div>

              {/* 环境变量 */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                  >
                    环境变量
                  </label>
                  <button
                    onClick={addEnvVar}
                    className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                      isDark
                        ? "border-gray-600 text-gray-300 hover:bg-gray-700"
                        : "border-gray-300 text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    + 添加
                  </button>
                </div>
                <div className="space-y-2">
                  {form.envVars.map((ev, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input
                        type="text"
                        value={ev.name}
                        onChange={(e) =>
                          updateEnvVar(i, "name", e.target.value)
                        }
                        placeholder="变量名"
                        className={`flex-1 text-sm bg-transparent outline-none border-b pb-1 ${
                          isDark
                            ? "border-gray-600 text-white placeholder-gray-500 focus:border-blue-400"
                            : "border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500"
                        }`}
                      />
                      <span className="text-xs text-gray-400">=</span>
                      <input
                        type="text"
                        value={ev.value}
                        onChange={(e) =>
                          updateEnvVar(i, "value", e.target.value)
                        }
                        placeholder="值"
                        className={`flex-1 text-sm bg-transparent outline-none border-b pb-1 ${
                          isDark
                            ? "border-gray-600 text-white placeholder-gray-500 focus:border-blue-400"
                            : "border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500"
                        }`}
                      />
                      <button
                        onClick={() => removeEnvVar(i)}
                        className={`p-0.5 rounded transition-colors ${
                          isDark
                            ? "text-gray-500 hover:text-red-400"
                            : "text-gray-400 hover:text-red-500"
                        }`}
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div
          className={`px-5 py-3 border-t flex justify-end gap-3 shrink-0 ${isDark ? "border-gray-700" : "border-gray-200"}`}
        >
          {onVerify && (
            <button
              onClick={onVerify}
              disabled={verifying}
              className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                verifying ? "opacity-50 cursor-not-allowed" : ""
              } ${
                isDark
                  ? "border-green-700 text-green-400 hover:bg-green-900/20"
                  : "border-green-300 text-green-600 hover:bg-green-50"
              }`}
            >
              {verifying ? "验证中..." : "验证连接"}
            </button>
          )}
          <button
            onClick={onClose}
            className={`px-4 py-2 text-sm rounded-lg transition-colors ${
              isDark
                ? "bg-gray-700 hover:bg-gray-600 text-gray-300"
                : "bg-gray-100 hover:bg-gray-200 text-gray-700"
            }`}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            {isEdit ? "保存" : "添加"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default MCPConfigModal;
