import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ConfigSection,
  ConfigItem,
  ToggleConfig,
  SelectConfig,
  TextConfig,
} from "./ConfigComponents";
import { httpLegacy as http } from "../../services/httpClient";

/** 工作空间信任级别 */
type WorkspaceTrustLevel = "chat" | "work" | "development";

/** 单个工作空间配置 */
interface WorkspaceConfig {
  path: string;
  trustLevel: WorkspaceTrustLevel;
  enabled: boolean;
  label?: string;
}

/** 权限配置 */
interface PermissionConfig {
  mode: "default" | "strict" | "permissive";
  trustedWorkspaces: WorkspaceConfig[];
}

interface TrustedWorkspacesPanelProps {
  isDark: boolean;
}

function TrustedWorkspacesPanel({ isDark }: TrustedWorkspacesPanelProps) {
  const { t } = useTranslation();
  const [permission, setPermission] = useState<PermissionConfig>({
    mode: "default",
    trustedWorkspaces: [],
  });
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newPath, setNewPath] = useState("");
  const [newLevel, setNewLevel] = useState<WorkspaceTrustLevel>("development");

  /** 加载权限配置 */
  const loadConfig = async () => {
    try {
      const res = await http.get<{ key: string; value: PermissionConfig }>(
        "/v1/config/permission"
      );
      if (res?.value) {
        setPermission(res.value);
      }
    } catch {
      setError("加载权限配置失败");
    }
  };

  /** 保存权限配置 */
  const saveConfig = async () => {
    setLoading(true);
    setSaved(false);
    setError(null);
    try {
      await http.put("/v1/config/permission", { value: permission });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("保存失败");
    } finally {
      setLoading(false);
    }
  };

  /** 添加工作空间 */
  const addWorkspace = () => {
    const trimmed = newPath.trim();
    if (!trimmed) return;
    if (permission.trustedWorkspaces.some((ws) => ws.path === trimmed)) {
      setError("该路径已存在");
      return;
    }
    setPermission({
      ...permission,
      trustedWorkspaces: [
        ...permission.trustedWorkspaces,
        { path: trimmed, trustLevel: newLevel, enabled: true },
      ],
    });
    setNewPath("");
    setError(null);
  };

  /** 删除工作空间 */
  const removeWorkspace = (index: number) => {
    setPermission({
      ...permission,
      trustedWorkspaces: permission.trustedWorkspaces.filter(
        (_, i) => i !== index
      ),
    });
  };

  /** 切换启用状态 */
  const toggleWorkspace = (index: number) => {
    const list = [...permission.trustedWorkspaces];
    list[index] = { ...list[index], enabled: !list[index].enabled };
    setPermission({ ...permission, trustedWorkspaces: list });
  };

  /** 更新工作空间级别 */
  const updateLevel = (index: number, level: WorkspaceTrustLevel) => {
    const list = [...permission.trustedWorkspaces];
    list[index] = { ...list[index], trustLevel: level };
    setPermission({ ...permission, trustedWorkspaces: list });
  };

  const LEVEL_LABELS: Record<WorkspaceTrustLevel, string> = {
    chat: "聊天（只读）",
    work: "工作（读写）",
    development: "开发（完全）",
  };

  // 首次渲染时加载
  useState(() => {
    loadConfig();
  });

  return (
    <ConfigSection
      title={t("settings.trustedWorkspaces")}
      description={t("settings.trustedWorkspacesDesc")}
      isDark={isDark}
    >
      {/* 权限模式 */}
      <ConfigItem label="默认权限模式" isDark={isDark}>
        <SelectConfig
          isDark={isDark}
          value={permission.mode}
          onChange={(value) =>
            setPermission({
              ...permission,
              mode: value as PermissionConfig["mode"],
            })
          }
          options={[
            { value: "default", label: "默认" },
            { value: "strict", label: "严格" },
            { value: "permissive", label: "宽松" },
          ]}
        />
      </ConfigItem>

      {/* 添加工作空间 */}
      <div className="flex items-end gap-2 py-3">
        <div className="flex-1">
          <TextConfig
            isDark={isDark}
            value={newPath}
            onChange={setNewPath}
            placeholder="输入工作空间绝对路径"
          />
        </div>
        <SelectConfig
          isDark={isDark}
          value={newLevel}
          onChange={(v) => setNewLevel(v as WorkspaceTrustLevel)}
          options={[
            { value: "development", label: "开发" },
            { value: "work", label: "工作" },
            { value: "chat", label: "聊天" },
          ]}
        />
        <button
          onClick={addWorkspace}
          disabled={!newPath.trim()}
          className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          添加
        </button>
      </div>

      {/* 工作空间列表 */}
      {permission.trustedWorkspaces.map((ws, i) => (
        <div
          key={i}
          className={`flex items-center gap-3 py-2 px-3 rounded mb-1 ${
            isDark ? "bg-gray-700" : "bg-gray-50"
          }`}
        >
          <ToggleConfig
            isDark={isDark}
            checked={ws.enabled}
            onChange={() => toggleWorkspace(i)}
          />
          <div className="flex-1 min-w-0">
            <div className={`text-sm truncate ${ws.enabled ? "" : "opacity-50"}`}>
              {ws.path}
            </div>
            <div className="text-xs text-gray-400">
              {LEVEL_LABELS[ws.trustLevel]}
            </div>
          </div>
          <SelectConfig
            isDark={isDark}
            value={ws.trustLevel}
            onChange={(v) => updateLevel(i, v as WorkspaceTrustLevel)}
            options={[
              { value: "development", label: "开发" },
              { value: "work", label: "工作" },
              { value: "chat", label: "聊天" },
            ]}
          />
          <button
            onClick={() => removeWorkspace(i)}
            className="text-red-400 hover:text-red-600 text-sm"
            aria-label={t("common.delete")}
          >
            {t("common.delete")}
          </button>
        </div>
      ))}

      {permission.trustedWorkspaces.length === 0 && (
        <p className={`text-xs py-2 ${isDark ? "text-gray-400" : "text-gray-500"}`}>
          尚未添加信任工作区。添加后 AI 在该目录内的操作将减少安全拦截。
        </p>
      )}

      {/* 保存按钮 */}
      <div className="pt-3 flex items-center gap-3">
        <button
          onClick={saveConfig}
          disabled={loading}
          className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? "保存中..." : "保存配置"}
        </button>
        {saved && (
          <span className="text-xs text-green-500">已保存</span>
        )}
        {error && (
          <span className="text-xs text-red-500">{error}</span>
        )}
      </div>
    </ConfigSection>
  );
}

export default TrustedWorkspacesPanel;
