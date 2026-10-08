import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfigSection, SelectConfig, ToggleConfig } from "./ConfigComponents";
import { vfsService } from "../../services/vfsService";
import type {
  VfsMcpServer,
  VfsMountEntry,
  VfsMountInput,
  VfsScheme,
} from "../../types/vfs";

interface VfsMountsPanelProps {
  isDark: boolean;
}

/** 源类型显示名 i18n key */
const SCHEME_LABEL_KEYS: Record<VfsScheme, string> = {
  dev_docs: "settings.vfsSchemeDevDocs",
  mcp: "settings.vfsSchemeMcp",
};

/**
 * VfsMountsPanel — VFS 挂载管理（设置页子页，Spec `ai-vfs-user-mountable.md` §8.3）
 *
 * 列出当前生效挂载 → 启停 `enabled` / 选择 MCP server → 保存（PUT `/v1/vfs/mounts`）。
 * 无热更新：保存成功后明示"需重启生效"；后端校验失败（400）时原位展示逐条原因。
 */
export default function VfsMountsPanel({ isDark }: VfsMountsPanelProps) {
  const { t } = useTranslation();
  const [mounts, setMounts] = useState<VfsMountEntry[]>([]);
  const [mcpServers, setMcpServers] = useState<VfsMcpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [requiresRestart, setRequiresRestart] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  /** 加载当前生效挂载计划 */
  async function refresh(): Promise<void> {
    setLoading(true);
    setLoadFailed(false);
    const res = await vfsService.listMounts();
    if (res.ok && res.data) {
      setMounts(res.data.mounts);
      setMcpServers(res.data.mcpServers);
    } else {
      setLoadFailed(true);
    }
    setLoading(false);
  }

  function updateEnabled(index: number, enabled: boolean): void {
    setMounts((prev) =>
      prev.map((m, i) => (i === index ? { ...m, enabled } : m)),
    );
  }

  function updateServer(index: number, server: string): void {
    setMounts((prev) =>
      prev.map((m, i) => (i === index ? { ...m, server } : m)),
    );
  }

  /** 保存（仅提交 scheme/server/enabled；registered/readOnly 由后端推导） */
  async function handleSave(): Promise<void> {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    setWarnings([]);
    const payload: VfsMountInput[] = mounts.map((m) => {
      const entry: VfsMountInput = { scheme: m.scheme, enabled: m.enabled };
      if (m.scheme === "mcp" && m.server) entry.server = m.server;
      return entry;
    });
    const res = await vfsService.saveMounts(payload);
    setSaving(false);
    if (res.ok && res.data) {
      setWarnings(res.data.warnings);
      setRequiresRestart(res.data.requiresRestart);
      setSaved(true);
    } else {
      setSaveError(res.error?.message ?? t("settings.vfsSaveFailed"));
    }
  }

  /** MCP server 选项：取 mcpServers（标注 connected）；当前值不在列表时补一条 */
  function serverOptions(
    mount: VfsMountEntry,
  ): { value: string; label: string }[] {
    const options = mcpServers.map((s) => ({
      value: s.name,
      label: s.connected
        ? t("settings.vfsMcpConnected", { name: s.name })
        : t("settings.vfsMcpDisconnected", { name: s.name }),
    }));
    const current = mount.server ?? "";
    if (current && !options.some((o) => o.value === current)) {
      options.unshift({
        value: current,
        label: t("settings.vfsMcpUnknown", { name: current }),
      });
    }
    return [{ value: "", label: t("settings.vfsSelectServer") }, ...options];
  }

  if (loading) {
    return (
      <ConfigSection isDark={isDark}>
        <div className="flex items-center gap-2 py-2">
          <span className="inline-block w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span
            className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            {t("settings.vfsLoading")}
          </span>
        </div>
      </ConfigSection>
    );
  }

  if (loadFailed) {
    return (
      <ConfigSection isDark={isDark}>
        <div className="rounded bg-red-50 dark:bg-red-900/20 p-3">
          <p className="text-sm text-red-600 dark:text-red-400">
            {t("settings.vfsLoadFailed")}
          </p>
          <button
            onClick={() => void refresh()}
            className="mt-2 px-3 py-1.5 text-sm rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            {t("settings.vfsRetry")}
          </button>
        </div>
      </ConfigSection>
    );
  }

  return (
    <ConfigSection isDark={isDark}>
      <p
        className={`mb-3 text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
      >
        {t("settings.vfsDesc")}
      </p>

      {mounts.length === 0 && (
        <p
          className={`text-sm py-2 ${isDark ? "text-gray-400" : "text-gray-500"}`}
        >
          {t("settings.vfsEmpty")}
        </p>
      )}

      {mounts.map((mount, index) => (
        <div
          key={`${mount.scheme}-${index}`}
          className={`flex items-center gap-3 py-2 px-3 rounded mb-1 ${
            isDark ? "bg-gray-700" : "bg-gray-50"
          }`}
        >
          <ToggleConfig
            isDark={isDark}
            checked={mount.enabled}
            onChange={(checked) => updateEnabled(index, checked)}
          />
          <div className="flex-1 min-w-0">
            <div
              className={`text-sm truncate ${mount.enabled ? "" : "opacity-50"}`}
            >
              {t(SCHEME_LABEL_KEYS[mount.scheme])}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span
                className={`text-xs ${
                  mount.registered
                    ? "text-green-600 dark:text-green-400"
                    : "text-gray-400"
                }`}
              >
                {mount.registered
                  ? t("settings.vfsRegistered")
                  : t("settings.vfsNotRegistered")}
              </span>
              {mount.readOnly && (
                <span className="text-xs text-gray-400">
                  {t("settings.vfsReadOnly")}
                </span>
              )}
            </div>
          </div>
          {mount.scheme === "mcp" && (
            <SelectConfig
              isDark={isDark}
              value={mount.server ?? ""}
              onChange={(value) => updateServer(index, value)}
              options={serverOptions(mount)}
            />
          )}
        </div>
      ))}

      {mounts.length > 0 && (
        <div className="pt-3 flex items-center gap-3">
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
          >
            {saving ? t("settings.vfsSaving") : t("settings.vfsSave")}
          </button>
          {saved && requiresRestart && (
            <span className="text-xs text-amber-500">
              {t("settings.vfsRequiresRestart")}
            </span>
          )}
          {saved && !requiresRestart && (
            <span className="text-xs text-green-500">
              {t("settings.vfsSaveSuccess")}
            </span>
          )}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mt-3 rounded bg-yellow-50 dark:bg-yellow-900/20 p-3">
          <p className="text-xs text-yellow-600 dark:text-yellow-400">
            {t("settings.vfsWarnings")}
          </p>
          {warnings.map((warning, index) => (
            <p
              key={index}
              className="text-xs text-yellow-600 dark:text-yellow-400"
            >
              {warning}
            </p>
          ))}
        </div>
      )}

      {saveError && (
        <div className="mt-3 rounded bg-red-50 dark:bg-red-900/20 p-3">
          <p className="text-xs text-red-600 dark:text-red-400">
            {t("settings.vfsSaveFailed")}
          </p>
          <p className="text-xs text-red-600 dark:text-red-400 whitespace-pre-line">
            {saveError}
          </p>
        </div>
      )}
    </ConfigSection>
  );
}
