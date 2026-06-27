import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";

interface SandboxConfig {
  enabled: boolean;
  memoryLimit: number;
  cpuLimit: number;
  networkAccess: boolean;
  fileSystemAccess: boolean;
  allowedPaths: string[];
  blockedPaths: string[];
}

interface SandboxSession {
  id: string;
  name: string;
  status: "running" | "stopped" | "error";
  startTime: string;
  duration: number;
  memoryUsage: number;
}

function SandboxPage() {
  const { t } = useTranslation();
  const { config, loadConfig } = useConfigStore();
  const isDark = config.theme === "dark";
  const [sandboxConfig, setSandboxConfig] = useState<SandboxConfig>({
    enabled: true,
    memoryLimit: 512,
    cpuLimit: 50,
    networkAccess: false,
    fileSystemAccess: true,
    allowedPaths: ["/tmp", "/var/sandbox"],
    blockedPaths: ["/etc", "/root", "/home"],
  });
  const [sessions] = useState<SandboxSession[]>([
    {
      id: "1",
      name: "代码执行沙箱",
      status: "running",
      startTime: "2026-05-28 10:00",
      duration: 3600,
      memoryUsage: 256,
    },
    {
      id: "2",
      name: "文件处理沙箱",
      status: "stopped",
      startTime: "2026-05-28 09:00",
      duration: 1800,
      memoryUsage: 0,
    },
    {
      id: "3",
      name: "AI推理沙箱",
      status: "error",
      startTime: "2026-05-28 08:00",
      duration: 0,
      memoryUsage: 0,
    },
  ]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const toggleSandbox = () => {
    setSandboxConfig((prev) => ({ ...prev, enabled: !prev.enabled }));
  };

  const handleConfigChange = (key: keyof SandboxConfig, value: unknown) => {
    setSandboxConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleAddPath = (type: "allowed" | "blocked", path: string) => {
    if (!path.trim()) return;
    const key = type === "allowed" ? "allowedPaths" : "blockedPaths";
    setSandboxConfig((prev) => ({
      ...prev,
      [key]: [...prev[key], path],
    }));
  };

  const handleRemovePath = (type: "allowed" | "blocked", path: string) => {
    const key = type === "allowed" ? "allowedPaths" : "blockedPaths";
    setSandboxConfig((prev) => ({
      ...prev,
      [key]: prev[key].filter((p) => p !== path),
    }));
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "running":
        return isDark
          ? "bg-green-900/30 text-green-400"
          : "bg-green-100 text-green-700";
      case "stopped":
        return isDark
          ? "bg-gray-700 text-gray-400"
          : "bg-gray-100 text-gray-600";
      case "error":
        return isDark
          ? "bg-red-900/30 text-red-400"
          : "bg-red-100 text-red-700";
      default:
        return isDark
          ? "bg-gray-700 text-gray-400"
          : "bg-gray-100 text-gray-600";
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "running":
        return t("sandbox.running");
      case "stopped":
        return t("sandbox.stopped");
      case "error":
        return t("sandbox.error");
      default:
        return status;
    }
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}小时${minutes}分钟`;
    return `${minutes}分钟`;
  };

  return (
    <div
      className={`flex-1 overflow-y-auto ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
    >
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1
              className={`text-2xl font-bold ${isDark ? "text-gray-100" : "text-gray-900"}`}
            >
              {t("sandbox.title")}
            </h1>
            <p
              className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              {t("sandbox.subtitle")}
            </p>
          </div>
          <button
            onClick={toggleSandbox}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              sandboxConfig.enabled
                ? "bg-red-600 hover:bg-red-700 text-white"
                : "bg-green-600 hover:bg-green-700 text-white"
            }`}
          >
            {sandboxConfig.enabled ? t("sandbox.disableSandbox") : t("sandbox.enableSandbox")}
          </button>
        </div>

        <div
          className={`rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"} p-6 mb-6`}
        >
          <h3
            className={`text-lg font-semibold mb-4 ${isDark ? "text-gray-100" : "text-gray-900"}`}
          >
            {t("sandbox.securityConfig")}
          </h3>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label
                className={`block text-sm font-medium mb-2 ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                {t("sandbox.memoryLimit")}
              </label>
              <input
                type="number"
                value={sandboxConfig.memoryLimit}
                onChange={(e) =>
                  handleConfigChange(
                    "memoryLimit",
                    parseInt(e.target.value, 10),
                  )
                }
                className={`w-full px-3 py-2 border rounded-lg ${isDark ? "bg-gray-700 border-gray-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
              />
            </div>
            <div>
              <label
                className={`block text-sm font-medium mb-2 ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                {t("sandbox.cpuLimit")}
              </label>
              <input
                type="number"
                value={sandboxConfig.cpuLimit}
                onChange={(e) =>
                  handleConfigChange("cpuLimit", parseInt(e.target.value, 10))
                }
                className={`w-full px-3 py-2 border rounded-lg ${isDark ? "bg-gray-700 border-gray-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
              />
            </div>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="networkAccess"
                checked={sandboxConfig.networkAccess}
                onChange={(e) =>
                  handleConfigChange("networkAccess", e.target.checked)
                }
                className="w-4 h-4"
              />
              <label
                htmlFor="networkAccess"
                className={`text-sm ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                {t("sandbox.allowNetwork")}
              </label>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="fileSystemAccess"
                checked={sandboxConfig.fileSystemAccess}
                onChange={(e) =>
                  handleConfigChange("fileSystemAccess", e.target.checked)
                }
                className="w-4 h-4"
              />
              <label
                htmlFor="fileSystemAccess"
                className={`text-sm ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                {t("sandbox.allowFileSystem")}
              </label>
            </div>
          </div>
        </div>

        <div
          className={`rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"} p-6 mb-6`}
        >
          <h3
            className={`text-lg font-semibold mb-4 ${isDark ? "text-gray-100" : "text-gray-900"}`}
          >
            {t("sandbox.pathConfig")}
          </h3>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label
                className={`block text-sm font-medium mb-2 ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                {t("sandbox.allowedPaths")}
              </label>
              <div className="space-y-2 mb-3">
                {sandboxConfig.allowedPaths.map((path) => (
                  <div key={path} className="flex items-center gap-2">
                    <span
                      className={`text-sm flex-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}
                    >
                      {path}
                    </span>
                    <button
                      onClick={() => handleRemovePath("allowed", path)}
                      className="text-red-500 hover:text-red-600"
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
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder={t("sandbox.addPath")}
                  className={`flex-1 px-3 py-1 border rounded ${isDark ? "bg-gray-700 border-gray-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleAddPath(
                        "allowed",
                        (e.target as HTMLInputElement).value,
                      );
                      (e.target as HTMLInputElement).value = "";
                    }
                  }}
                />
              </div>
            </div>
            <div>
              <label
                className={`block text-sm font-medium mb-2 ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                {t("sandbox.blockedPaths")}
              </label>
              <div className="space-y-2 mb-3">
                {sandboxConfig.blockedPaths.map((path) => (
                  <div key={path} className="flex items-center gap-2">
                    <span
                      className={`text-sm flex-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}
                    >
                      {path}
                    </span>
                    <button
                      onClick={() => handleRemovePath("blocked", path)}
                      className="text-red-500 hover:text-red-600"
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
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder={t("sandbox.addPath")}
                  className={`flex-1 px-3 py-1 border rounded ${isDark ? "bg-gray-700 border-gray-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleAddPath(
                        "blocked",
                        (e.target as HTMLInputElement).value,
                      );
                      (e.target as HTMLInputElement).value = "";
                    }
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        <div
          className={`rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"} p-6`}
        >
          <h3
            className={`text-lg font-semibold mb-4 ${isDark ? "text-gray-100" : "text-gray-900"}`}
          >
            {t("sandbox.sessions")}
          </h3>
          <div className="space-y-3">
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`p-4 rounded-lg border ${isDark ? "border-gray-700 bg-gray-700/50" : "border-gray-200 bg-gray-50"}`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h4
                      className={`font-medium ${isDark ? "text-gray-100" : "text-gray-900"}`}
                    >
                      {session.name}
                    </h4>
                    <p
                      className={`text-xs mt-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                    >
                      {t("sandbox.startTime")}: {session.startTime}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    {session.status === "running" && (
                      <span className="text-sm text-gray-500">
                        {t("sandbox.memory")}: {session.memoryUsage}MB | {t("sandbox.duration")}:{" "}
                        {formatDuration(session.duration)}
                      </span>
                    )}
                    <span
                      className={`px-2 py-1 text-xs rounded-full ${getStatusColor(session.status)}`}
                    >
                      {getStatusText(session.status)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SandboxPage;
