import { useCallback, useEffect, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { schemaService } from "../../../services/schemaService";
import type {
  OntologyBackupEntry,
  OntologyBackupList,
  OntologySchemaFile,
} from "../../../types/project";

/**
 * 「历史备份与恢复」面板（D1 = C / B2c）
 *
 * 数据来源：`GET /v1/knowledge/schema/backup`（只读列表）+
 * `POST /v1/knowledge/schema/backup/{id}/restore`（恢复单个文件）。
 *
 * 服务端保证（见 §11.5 写入安全）：
 * - 每次写入/恢复都会把**上一个版本**备份到 `<schemaDir>/.backup/<时间戳>/`，保留最近 10 份；
 * - 恢复前**先校验**备份内容，不过则拒绝且不做任何改动；
 * - 恢复前**先备份当前状态** → 恢复动作本身可回滚。
 */

/** 可恢复的文件（与后端写白名单一致） */
const RESTORABLE_FILES: OntologySchemaFile[] = [
  "entities.yaml",
  "edges.yaml",
  "xref.yaml",
];

function isRestorable(name: string): name is OntologySchemaFile {
  return (RESTORABLE_FILES as string[]).includes(name);
}

interface OntologyBackupPanelProps {
  isDark: boolean;
  /** 恢复成功后刷新父页面（文件内容已变） */
  onChanged: () => void;
  /** O17：目标域（缺省 = 全局目录，与改造前一致） */
  domain?: string;
}

export function OntologyBackupPanel({
  isDark,
  onChanged,
  domain,
}: OntologyBackupPanelProps) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<OntologyBackupList | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const cardClass = isDark
    ? "bg-gray-800 border-gray-700"
    : "bg-white border-gray-200";
  const textPrimary = isDark ? "text-gray-100" : "text-gray-900";
  const textSecondary = isDark ? "text-gray-400" : "text-gray-500";
  const divider = isDark ? "border-gray-700" : "border-gray-200";
  const secondaryButton = `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-colors disabled:opacity-50 ${
    isDark
      ? "border-gray-600 text-gray-300 hover:bg-gray-700"
      : "border-gray-300 text-gray-700 hover:bg-gray-100"
  }`;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await schemaService.listBackups(domain));
    } catch (err) {
      setError(
        err instanceof Error
          ? `读取备份列表失败：${err.message}`
          : "读取备份列表失败",
      );
    } finally {
      setLoading(false);
    }
  }, [domain]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const restore = async (entry: OntologyBackupEntry, file: string) => {
    if (!isRestorable(file)) return;
    const when = entry.createdAt
      ? new Date(entry.createdAt).toLocaleString()
      : entry.id;
    const confirmed = confirm(
      `用 ${when} 的备份覆盖 ${file}？\n\n` +
        "· 覆盖前会先备份当前内容，之后仍可恢复回来\n" +
        "· 编辑器里未保存的改动会丢失\n" +
        "· 保存只影响下一次编译，不改动已入库数据",
    );
    if (!confirmed) return;

    const key = `${entry.id}:${file}`;
    setBusyKey(key);
    setError("");
    setMessage("");
    try {
      await schemaService.restoreBackup(entry.id, file, domain);
      setMessage(`已恢复 ${file}（来自 ${when}）`);
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? `恢复失败：${err.message}` : "恢复失败");
    } finally {
      setBusyKey("");
    }
  };

  const backupCount = data?.backups.length ?? 0;

  return (
    <div className={`border rounded-lg overflow-hidden ${cardClass}`}>
      <button
        onClick={() => setOpen((value) => !value)}
        className={`w-full px-4 py-2.5 flex items-center justify-between ${textPrimary}`}
      >
        <span className="text-sm font-medium">
          历史备份{open ? `（${backupCount}）` : ""}
        </span>
        <span className={`text-xs ${textSecondary}`}>
          {open ? "▲ 收起" : "▼ 展开"}
        </span>
      </button>

      {open && (
        <div className={`border-t px-4 py-3 ${divider}`}>
          {error && (
            <div
              className={`mb-3 px-3 py-2 rounded-md text-xs ${
                isDark
                  ? "bg-red-900/30 text-red-300 border border-red-800"
                  : "bg-red-50 text-red-700 border border-red-200"
              }`}
            >
              {error}
            </div>
          )}
          {message && !error && (
            <div
              className={`mb-3 px-3 py-2 rounded-md text-xs ${
                isDark
                  ? "bg-emerald-900/30 text-emerald-300 border border-emerald-800"
                  : "bg-emerald-50 text-emerald-700 border border-emerald-200"
              }`}
            >
              {message}
            </div>
          )}

          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => void load()}
              disabled={loading}
              className={secondaryButton}
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RotateCcw className="w-3.5 h-3.5" />
              )}
              刷新
            </button>
            <span className={`text-xs ${textSecondary}`}>
              每次保存与恢复都会先备份上一个版本，最多保留 {data?.keep ?? 10} 份
            </span>
          </div>

          {data && data.backups.length === 0 ? (
            <div className={`text-xs ${textSecondary}`}>
              暂无备份：第一次保存后这里会出现旧版本，可随时恢复。
            </div>
          ) : (
            <ul className="space-y-2">
              {(data?.backups ?? []).map((entry) => (
                <li
                  key={entry.id}
                  className={`flex flex-wrap items-center gap-3 text-xs ${
                    isDark ? "text-gray-300" : "text-gray-700"
                  }`}
                >
                  <span className={`font-mono ${textSecondary}`}>
                    {entry.createdAt
                      ? new Date(entry.createdAt).toLocaleString()
                      : entry.id}
                  </span>
                  {entry.files.map((file) =>
                    isRestorable(file.name) ? (
                      <button
                        key={file.name}
                        onClick={() => void restore(entry, file.name)}
                        disabled={busyKey !== ""}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded border transition-colors disabled:opacity-50 ${
                          isDark
                            ? "border-gray-600 hover:bg-gray-700"
                            : "border-gray-300 hover:bg-gray-100"
                        }`}
                        title={`恢复 ${file.name}`}
                      >
                        {busyKey === `${entry.id}:${file.name}` ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : null}
                        <span className="font-mono">{file.name}</span>
                      </button>
                    ) : (
                      <span key={file.name} className={textSecondary}>
                        <span className="font-mono">{file.name}</span>
                        （不支持恢复）
                      </span>
                    ),
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
